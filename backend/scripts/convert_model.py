"""Convertit un modèle Whisper Hugging Face en CTranslate2 pour faster-whisper.

    uv run --group convert python scripts/convert_model.py tarteel-ai/whisper-base-ar-quran

Le résultat est écrit dans backend/models/<nom>-ct2 (float16 : utilisable
sur GPU, et sur CPU où CTranslate2 le convertit à la volée en int8/float32).
"""

from __future__ import annotations

import argparse
import shutil
import tempfile
from pathlib import Path

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


def convert(model_id: str, quantization: str, force: bool) -> Path:
    from ctranslate2.converters import TransformersConverter
    from transformers import WhisperProcessor

    out = MODELS_DIR / (model_id.split("/")[-1] + "-ct2")
    if out.exists() and not force:
        print(f"Déjà converti : {out}")
        return out

    # faster-whisper attend tokenizer.json + preprocessor_config.json ; certains
    # dépôts (dont tarteel-ai) n'ont que vocab.json/merges.txt : on les régénère.
    with tempfile.TemporaryDirectory() as tmp:
        processor = WhisperProcessor.from_pretrained(model_id)
        processor.save_pretrained(tmp)
        conv = TransformersConverter(model_id, load_as_float16=quantization == "float16")
        conv.convert(str(out), quantization=quantization, force=True)
        for name in ("tokenizer.json", "preprocessor_config.json"):
            src = Path(tmp) / name
            if src.exists():
                shutil.copy(src, out / name)
    print(f"OK -> {out}")
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("model", nargs="+", help="identifiant(s) Hugging Face")
    p.add_argument("--quantization", default="float16")
    p.add_argument("--force", action="store_true")
    a = p.parse_args()
    for m in a.model:
        convert(m, a.quantization, a.force)


if __name__ == "__main__":
    main()
