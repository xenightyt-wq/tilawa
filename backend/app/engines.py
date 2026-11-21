"""Couche de reconnaissance vocale, isolée derrière une interface commune.

Pour changer de moteur (autre modèle, inférence ONNX, service distant...),
il suffit d'implémenter `AsrEngine.transcribe`.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from .config import SAMPLE_RATE, Settings

log = logging.getLogger("asr.engine")


@dataclass
class Transcript:
    text: str
    avg_logprob: float
    no_speech_prob: float
    audio_ms: int
    latency_ms: int


class AsrEngine(Protocol):
    name: str
    model: str
    device: str

    def transcribe(self, audio: np.ndarray, *, final: bool) -> Transcript: ...


class FasterWhisperEngine:
    """Whisper (CTranslate2) via faster-whisper. Thread-safe par verrou :
    un seul décodage à la fois sur le GPU, les sessions se partagent le modèle."""

    name = "faster-whisper"

    def __init__(self, settings: Settings):
        from . import cuda_dlls

        cuda_dlls.register()
        import ctranslate2
        from faster_whisper import WhisperModel

        device = settings.device
        if device == "auto":
            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        compute = settings.compute_type
        if compute == "auto":
            compute = "float16" if device == "cuda" else "int8"
        self.model = settings.model
        self.device = f"{device}/{compute}"
        self.beam_final = settings.beam_size_final
        log.info("Chargement du modèle %s (%s)…", self.model, self.device)
        self._model = WhisperModel(settings.model, device=device, compute_type=compute)
        self._lock = threading.Lock()
        # Préchauffage : le premier décodage est toujours plus lent.
        self.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32), final=False)
        log.info("Modèle prêt.")

    def transcribe(self, audio: np.ndarray, *, final: bool) -> Transcript:
        t0 = time.perf_counter()
        with self._lock:
            segments, _info = self._model.transcribe(
                audio,
                language="ar",
                task="transcribe",
                beam_size=self.beam_final if final else 1,
                best_of=1,
                temperature=0.0,
                condition_on_previous_text=False,
                without_timestamps=True,
                vad_filter=False,
                # Pas de prompt avec le texte attendu : cela masquerait les fautes.
                initial_prompt=None,
            )
            segs = list(segments)
        text = " ".join(s.text.strip() for s in segs).strip()
        avg = float(np.mean([s.avg_logprob for s in segs])) if segs else -10.0
        nsp = float(max((s.no_speech_prob for s in segs), default=1.0))
        # Garde-fou contre les "hallucinations" sur du bruit.
        if nsp > 0.6 and avg < -1.0:
            text = ""
        return Transcript(
            text=text,
            avg_logprob=avg,
            no_speech_prob=nsp,
            audio_ms=int(len(audio) * 1000 / SAMPLE_RATE),
            latency_ms=int((time.perf_counter() - t0) * 1000),
        )


class FakeEngine:
    """Moteur factice pour les tests : renvoie un texte scripté proportionnel
    à la durée d'audio reçue (1 mot par 0,5 s)."""

    name = "fake"
    device = "none"

    def __init__(self, script: str = "قل هو الله احد الله الصمد لم يلد ولم يولد ولم يكن له كفوا احد"):
        self.model = "fake"
        self.words = script.split()
        self.calls: list[tuple[int, bool]] = []

    def transcribe(self, audio: np.ndarray, *, final: bool) -> Transcript:
        ms = int(len(audio) * 1000 / SAMPLE_RATE)
        self.calls.append((ms, final))
        n = min(len(self.words), max(0, ms // 500))
        return Transcript(" ".join(self.words[:n]), -0.2, 0.0, ms, 1)


def create_engine(settings: Settings) -> AsrEngine:
    if settings.engine == "fake":
        return FakeEngine()
    if settings.engine == "faster-whisper":
        return FasterWhisperEngine(settings)
    raise ValueError(f"Moteur inconnu : {settings.engine}")
