"""Détection d'activité vocale (VAD) légère, par énergie avec plancher de bruit
adaptatif. Suffisant pour découper une récitation (voix forte, pauses nettes
entre versets) ; Silero VAD est une amélioration possible (voir LIMITES)."""

from __future__ import annotations

import numpy as np

from .config import SAMPLE_RATE

FRAME_MS = 30
FRAME = SAMPLE_RATE * FRAME_MS // 1000


class EnergyVad:
    def __init__(self, margin_db: float = 9.0, min_speech_db: float = -48.0):
        self.margin_db = margin_db
        self.min_speech_db = min_speech_db
        self.noise_db = -60.0
        self._initialised = False

    @staticmethod
    def level_db(frame: np.ndarray) -> float:
        rms = float(np.sqrt(np.mean(np.square(frame, dtype=np.float64)) + 1e-12))
        return 20.0 * np.log10(rms + 1e-9)

    def is_speech(self, frame: np.ndarray) -> bool:
        db = self.level_db(frame)
        if not self._initialised:
            self.noise_db = min(db, -35.0)
            self._initialised = True
        speech = db > max(self.noise_db + self.margin_db, self.min_speech_db)
        # Plancher : descend vite, remonte lentement (et pas pendant la parole).
        if db < self.noise_db:
            self.noise_db = 0.7 * self.noise_db + 0.3 * db
        elif not speech:
            self.noise_db = 0.98 * self.noise_db + 0.02 * db
        return speech
