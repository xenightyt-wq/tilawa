"""Normalisation arabe (miroir de frontend/src/core/arabic.ts), utilisée par
le banc d'essai. La comparaison en production se fait côté client."""

from __future__ import annotations

import re

_STRIP = re.compile("[ؐ-ًؚ-ٰٟۖ-ۭـ]")
_MAP = str.maketrans(
    {
        "ٱ": "ا",
        "آ": "ا",
        "أ": "ا",
        "إ": "ا",
        "ٲ": "ا",
        "ٳ": "ا",
        "ؤ": "و",
        "ئ": "ي",
        "ى": "ي",
        "ة": "ه",
        "ۀ": "ه",
        "ک": "ك",
        "ی": "ي",
        "ء": "",
    }
)
_NON_LETTER = re.compile("[^ا-غف-ي]")


def normalize_word(w: str) -> str:
    return _NON_LETTER.sub("", _STRIP.sub("", w).translate(_MAP))


def tokenize(text: str) -> list[str]:
    return [t for t in (normalize_word(x) for x in text.split()) if t]


def wer(ref: list[str], hyp: list[str]) -> tuple[int, int]:
    """(erreurs, longueur de référence) — distance d'édition en mots."""
    prev = list(range(len(hyp) + 1))
    for i in range(1, len(ref) + 1):
        cur = [i] + [0] * len(hyp)
        for j in range(1, len(hyp) + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ref[i - 1] != hyp[j - 1]))
        prev = cur
    return prev[len(hyp)], len(ref)
