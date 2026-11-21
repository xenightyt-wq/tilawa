"""Configuration via variables d'environnement (voir README)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


@dataclass(frozen=True)
class Settings:
    # Moteur : "faster-whisper" (défaut) ou "fake" (tests / démo sans modèle)
    engine: str = field(default_factory=lambda: _env("ASR_ENGINE", "faster-whisper"))
    # Dossier d'un modèle CTranslate2 (voir scripts/convert_model.py) ou identifiant HF
    model: str = field(
        default_factory=lambda: _env(
            "ASR_MODEL", str(BACKEND_DIR / "models" / "whisper-small-ar-quran-mix-norm-ct2")
        )
    )
    device: str = field(default_factory=lambda: _env("ASR_DEVICE", "auto"))  # auto|cuda|cpu
    compute_type: str = field(default_factory=lambda: _env("ASR_COMPUTE_TYPE", "auto"))
    beam_size_final: int = field(default_factory=lambda: int(_env("ASR_BEAM_FINAL", "3")))

    # Streaming / VAD (millisecondes)
    partial_interval_ms: int = field(default_factory=lambda: int(_env("ASR_PARTIAL_MS", "500")))
    end_silence_ms: int = field(default_factory=lambda: int(_env("ASR_END_SILENCE_MS", "650")))
    max_segment_ms: int = field(default_factory=lambda: int(_env("ASR_MAX_SEGMENT_MS", "20000")))
    preroll_ms: int = 300
    min_partial_audio_ms: int = 450

    # Frontend compilé servi par le même serveur (optionnel)
    static_dir: str = field(
        default_factory=lambda: _env("STATIC_DIR", str(BACKEND_DIR.parent / "frontend" / "dist"))
    )
    # Origines autorisées (CORS), séparées par des virgules ; "*" en dev
    cors_origins: str = field(default_factory=lambda: _env("CORS_ORIGINS", "*"))
    # Par défaut, aucune transcription n'est journalisée (confidentialité)
    log_transcripts: bool = field(default_factory=lambda: _env("LOG_TRANSCRIPTS", "0") == "1")


SAMPLE_RATE = 16_000
