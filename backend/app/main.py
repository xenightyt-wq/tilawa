"""Serveur FastAPI : reconnaissance vocale en streaming par WebSocket.

Protocole /ws/asr
  client → serveur : trames binaires PCM 16 bits LE, mono, 16 kHz
                     texte JSON {"type": "reset" | "flush"}
  serveur → client : {"type": "ready", engine, model, device}
                     {"type": "vad", speaking}
                     {"type": "partial" | "final", segment, text, confidence,
                      audio_ms, latency_ms}
                     {"type": "error", message}

Confidentialité : l'audio n'est jamais écrit sur disque ni journalisé ; il vit
en mémoire le temps d'un segment puis est libéré.
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import Settings
from .engines import AsrEngine, create_engine
from .streaming import Job, Segmenter, pcm16_to_float

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("asr")

MAX_FRAME_BYTES = 64_000  # ~2 s d'audio par message, au-delà on refuse


def build_app(settings: Settings | None = None, engine: AsrEngine | None = None) -> FastAPI:
    settings = settings or Settings()
    state: dict[str, AsrEngine | str | None] = {"engine": engine, "error": None}

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if state["engine"] is None:
            try:
                state["engine"] = await asyncio.to_thread(create_engine, settings)
            except Exception as exc:  # modèle absent, CUDA indisponible…
                log.exception("Impossible de charger le moteur")
                state["error"] = str(exc)
        yield

    app = FastAPI(title="Récitation Coran — ASR", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
        allow_methods=["GET"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    async def health():
        eng = state["engine"]
        if eng is None:
            return {"ok": False, "error": state["error"] or "chargement en cours"}
        return {"ok": True, "engine": eng.name, "model": Path(eng.model).name, "device": eng.device}

    @app.websocket("/ws/asr")
    async def ws_asr(ws: WebSocket):
        await ws.accept()
        eng = state["engine"]
        if eng is None:
            await ws.send_json({"type": "error", "message": state["error"] or "moteur non prêt"})
            await ws.close()
            return
        await ws.send_json(
            {"type": "ready", "engine": eng.name, "model": Path(eng.model).name, "device": eng.device}
        )
        await AsrSession(ws, eng, settings).run()

    _mount_frontend(app, Path(settings.static_dir))
    return app


class AsrSession:
    """Une connexion : un segmenteur + un worker de décodage.
    Les finals sont tous traités ; seul le dernier partiel en attente est gardé."""

    def __init__(self, ws: WebSocket, engine: AsrEngine, settings: Settings):
        self.ws = ws
        self.engine = engine
        self.settings = settings
        self.seg = Segmenter(settings)
        self.finals: list[Job] = []
        self.partial: Job | None = None
        self.wake = asyncio.Event()
        self.closed = False
        self.speaking = False

    async def run(self) -> None:
        worker = asyncio.create_task(self._worker())
        try:
            while True:
                msg = await self.ws.receive()
                if msg["type"] == "websocket.disconnect":
                    break
                if msg.get("bytes") is not None:
                    data = msg["bytes"]
                    if len(data) > MAX_FRAME_BYTES or len(data) % 2:
                        await self.ws.send_json({"type": "error", "message": "trame audio invalide"})
                        continue
                    self._enqueue(self.seg.add(pcm16_to_float(data)))
                    if self.seg.speaking != self.speaking:
                        self.speaking = self.seg.speaking
                        await self.ws.send_json({"type": "vad", "speaking": self.speaking})
                elif msg.get("text") is not None:
                    await self._control(msg["text"])
        except WebSocketDisconnect:
            pass
        finally:
            self.closed = True
            self.wake.set()
            await worker
            self.finals.clear()
            self.partial = None

    async def _control(self, text: str) -> None:
        try:
            cmd = json.loads(text).get("type")
        except (ValueError, AttributeError):
            return
        if cmd == "reset":
            self.seg.reset()
            self.partial = None
            self.finals.clear()
        elif cmd == "flush":
            self._enqueue(self.seg.flush())

    def _enqueue(self, jobs: list[Job]) -> None:
        for job in jobs:
            if job.kind == "final":
                self.finals.append(job)
                if self.partial and self.partial.segment == job.segment:
                    self.partial = None
            else:
                self.partial = job
        if jobs:
            self.wake.set()

    async def _worker(self) -> None:
        while not self.closed:
            await self.wake.wait()
            self.wake.clear()
            while not self.closed and (self.finals or self.partial):
                if self.finals:
                    job = self.finals.pop(0)
                else:
                    job, self.partial = self.partial, None
                # Partiel d'un segment déjà terminé ou abandonné : inutile de décoder.
                if job is None or (job.kind == "partial" and job.segment != self.seg.segment):
                    continue
                try:
                    tr = await asyncio.to_thread(
                        self.engine.transcribe, job.audio, final=job.kind == "final"
                    )
                except Exception as exc:  # pragma: no cover
                    log.exception("Échec du décodage")
                    await self._send({"type": "error", "message": str(exc)})
                    continue
                finally:
                    job.audio = None  # type: ignore[assignment]  # libère l'audio
                if self.settings.log_transcripts:
                    log.info("[%s %d] %s", job.kind, job.segment, tr.text)
                await self._send(
                    {
                        "type": job.kind,
                        "segment": job.segment,
                        "text": tr.text,
                        "confidence": round(tr.avg_logprob, 3),
                        "audio_ms": tr.audio_ms,
                        "latency_ms": tr.latency_ms,
                    }
                )

    async def _send(self, payload: dict) -> None:
        if self.closed:
            return
        try:
            await self.ws.send_json(payload)
        except Exception:
            self.closed = True


def _mount_frontend(app: FastAPI, dist: Path) -> None:
    """Sert la PWA compilée (même origine : pas de CORS, un seul HTTPS)."""
    index = dist / "index.html"
    if not index.exists():
        return
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}")
    async def spa(path: str):
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and dist.resolve() in candidate.parents:
            return FileResponse(candidate)
        # Fichiers de modèle absents : vrai 404 (transformers.js teste des
        # fichiers optionnels et prendrait la page HTML pour une configuration).
        if path.startswith(("models/", "ort/")):
            return Response(status_code=404)
        return FileResponse(index)


app = build_app()
