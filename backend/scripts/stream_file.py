"""Diffuse un fichier audio vers /ws/asr en temps réel (outil de test).

    uv run python scripts/stream_file.py chemin.mp3 [--url ws://localhost:8000/ws/asr] [--speed 1]

Affiche chaque message reçu avec le temps écoulé depuis le début.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


async def main() -> None:
    import websockets
    from faster_whisper.audio import decode_audio

    p = argparse.ArgumentParser()
    p.add_argument("files", nargs="+")
    p.add_argument("--url", default="ws://localhost:8000/ws/asr")
    p.add_argument("--speed", type=float, default=1.0)
    p.add_argument("--gap", type=float, default=1.0, help="silence entre fichiers (s)")
    a = p.parse_args()

    sr = 16_000
    parts = []
    for f in a.files:
        parts += [decode_audio(f, sampling_rate=sr), np.zeros(int(a.gap * sr), np.float32)]
    audio = np.concatenate([np.zeros(sr // 2, np.float32), *parts])
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    chunk = sr // 10  # 100 ms

    async with websockets.connect(a.url, max_size=None) as ws:
        print(await ws.recv())
        t0 = time.perf_counter()

        async def reader():
            async for msg in ws:
                m = json.loads(msg)
                if m["type"] != "vad":
                    print(f"{time.perf_counter() - t0:6.2f}s {m}", flush=True)

        task = asyncio.create_task(reader())
        for k in range(0, len(pcm), chunk):
            await ws.send(pcm[k : k + chunk].tobytes())
            await asyncio.sleep(0.1 / a.speed)
        await asyncio.sleep(2.5)
        task.cancel()


if __name__ == "__main__":
    asyncio.run(main())
