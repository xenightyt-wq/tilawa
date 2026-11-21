"""Découpage du flux audio en segments de parole et planification des décodages.

Logique pure (sans réseau) pour être testable :
  - avant la parole : on garde ~300 ms de "pré-roll" ;
  - pendant la parole : une transcription *partielle* toutes les ~500 ms ;
  - après ~650 ms de silence (ou 20 s de segment) : transcription *finale*,
    puis nouveau segment.
L'audio n'est conservé qu'en mémoire, le temps du segment.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Literal

import numpy as np

from .config import SAMPLE_RATE, Settings
from .vad import FRAME, FRAME_MS, EnergyVad


@dataclass
class Job:
    kind: Literal["partial", "final"]
    segment: int
    audio: np.ndarray


class Segmenter:
    def __init__(self, settings: Settings):
        self.s = settings
        self.vad = EnergyVad()
        self.segment = 0
        self._carry = np.zeros(0, dtype=np.float32)
        self._preroll: deque[np.ndarray] = deque(maxlen=max(1, settings.preroll_ms // FRAME_MS))
        self._frames: list[np.ndarray] = []
        self._in_speech = False
        self._speech_run = 0
        self._silence_ms = 0
        self._since_decode_ms = 0
        self.speaking = False  # état exposé au client (indicateur)

    @property
    def segment_ms(self) -> int:
        return len(self._frames) * FRAME_MS

    def reset(self) -> None:
        """Abandonne le segment en cours (ex. après une faute en mode stop)."""
        self.segment += 1
        self._frames = []
        self._in_speech = False
        self._speech_run = 0
        self._silence_ms = 0
        self._since_decode_ms = 0
        self.speaking = False
        self._preroll.clear()

    def flush(self) -> list[Job]:
        """Termine le segment en cours (ex. bouton stop)."""
        if self._in_speech and self._frames:
            job = Job("final", self.segment, np.concatenate(self._frames))
            self.reset()
            return [job]
        self.reset()
        return []

    def add(self, samples: np.ndarray) -> list[Job]:
        jobs: list[Job] = []
        data = np.concatenate([self._carry, samples.astype(np.float32, copy=False)])
        n = len(data) // FRAME * FRAME
        self._carry = data[n:]
        for k in range(0, n, FRAME):
            frame = data[k : k + FRAME]
            speech = self.vad.is_speech(frame)
            job = self._step(frame, speech)
            if job:
                jobs.append(job)
        return jobs

    def _step(self, frame: np.ndarray, speech: bool) -> Job | None:
        if not self._in_speech:
            self._preroll.append(frame)
            self._speech_run = self._speech_run + 1 if speech else 0
            if self._speech_run >= 3:  # ~90 ms de parole continue
                self._in_speech = True
                self.speaking = True
                self._frames = list(self._preroll)
                self._preroll.clear()
                self._silence_ms = 0
                self._since_decode_ms = 0
            return None

        self._frames.append(frame)
        self._since_decode_ms += FRAME_MS
        if speech:
            self._silence_ms = 0
            self.speaking = True
        else:
            self._silence_ms += FRAME_MS
            if self._silence_ms >= 200:
                self.speaking = False

        if self._silence_ms >= self.s.end_silence_ms or self.segment_ms >= self.s.max_segment_ms:
            audio = np.concatenate(self._frames)
            seg = self.segment
            self.reset()
            return Job("final", seg, audio)

        if (
            self._since_decode_ms >= self.s.partial_interval_ms
            and self.segment_ms >= self.s.min_partial_audio_ms
            and self._silence_ms < 300
        ):
            self._since_decode_ms = 0
            return Job("partial", self.segment, np.concatenate(self._frames))
        return None


def pcm16_to_float(buf: bytes) -> np.ndarray:
    return np.frombuffer(buf, dtype="<i2").astype(np.float32) / 32768.0


__all__ = ["Job", "Segmenter", "pcm16_to_float", "SAMPLE_RATE"]
