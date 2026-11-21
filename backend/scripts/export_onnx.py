"""Exporte un modèle Whisper Hugging Face au format attendu par transformers.js
(inférence dans le navigateur / sur le téléphone).

    uv run --extra cuda --group convert python scripts/export_onnx.py tarteel-ai/whisper-base-ar-quran

Sortie : frontend/public/models/<nom>/ (config, tokenizer, onnx/*.onnx)
  - encoder_model.onnx / decoder_model_merged.onnx           (fp32)
  - encoder_model_quantized.onnx / decoder_model_merged_quantized.onnx  (int8 dynamique, "q8")
"""

from __future__ import annotations

import argparse
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_BASE = ROOT / "frontend" / "public" / "models"
KEEP = [
    "config.json",
    "generation_config.json",
    "preprocessor_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "added_tokens.json",
    "normalizer.json",
    "vocab.json",
    "merges.txt",
]


def export(model_id: str, base_for_generation: str, force: bool) -> Path:
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from optimum.exporters.onnx import main_export
    from transformers import GenerationConfig, WhisperProcessor

    out = OUT_BASE / model_id.split("/")[-1]
    if out.exists() and not force:
        print(f"Déjà exporté : {out}")
        return out
    shutil.rmtree(out, ignore_errors=True)
    (out / "onnx").mkdir(parents=True)

    with tempfile.TemporaryDirectory() as tmp:
        main_export(
            model_id,
            output=tmp,
            task="automatic-speech-recognition-with-past",
            opset=17,
            no_post_process=False,
        )
        tmpp = Path(tmp)
        print("Fichiers exportés :", sorted(p.name for p in tmpp.iterdir()))
        for name in ("encoder_model.onnx", "decoder_model_merged.onnx"):
            src = tmpp / name
            if not src.exists():
                raise SystemExit(f"{name} absent de l'export")
            shutil.copy(src, out / "onnx" / name)
            # poids externes éventuels (> 2 Go uniquement, normalement absents)
            for extra in tmpp.glob(name + "_data"):
                shutil.copy(extra, out / "onnx" / extra.name)
            quantize_dynamic(
                str(out / "onnx" / name),
                str(out / "onnx" / name.replace(".onnx", "_quantized.onnx")),
                weight_type=QuantType.QUInt8,
                # le décodeur "merged" contient ses poids dans des sous-graphes (If)
                extra_options={"EnableSubgraph": True},
            )

        processor = WhisperProcessor.from_pretrained(model_id)
        processor.save_pretrained(tmp)
        for name in KEEP:
            if (tmpp / name).exists():
                shutil.copy(tmpp / name, out / name)

    # Configuration de génération multilingue (langue/tâche) : certains modèles
    # affinés n'en ont pas ; on reprend celle du Whisper de base correspondant.
    try:
        gen = GenerationConfig.from_pretrained(model_id)
        if not getattr(gen, "lang_to_id", None):
            raise ValueError
    except Exception:
        gen = GenerationConfig.from_pretrained(base_for_generation)
    gen.save_pretrained(out)

    for f in sorted((out / "onnx").iterdir()):
        print(f"  {f.name:42s} {f.stat().st_size / 1e6:7.1f} Mo")
    print(f"OK -> {out}")
    return out


def variants(out: Path, kinds: list[str]) -> None:
    """Formats adaptés à WebGPU : fp16 (encodeur) et 4 bits (décodeur).
    transformers.js choisit le fichier selon le suffixe (_fp16, _q4)."""
    import onnx

    # Seul l'encodeur passe en fp16 (WebGPU) ; le décodeur reste en q8 sur le
    # CPU. La conversion fp16 du décodeur fusionné (directe, ou par moitiés puis
    # fusion) produit un graphe rejeté par ONNX Runtime Web (Add float/float16) :
    # piste d'amélioration, cf. LIMITES.md.
    for name in ("encoder_model",):
        src = out / "onnx" / f"{name}.onnx"
        if "fp16" in kinds:
            from onnxconverter_common import float16

            m = float16.convert_float_to_float16(
                onnx.load(str(src)), keep_io_types=True, disable_shape_infer=True
            )
            onnx.save(m, str(out / "onnx" / f"{name}_fp16.onnx"))
        if "q4" in kinds:
            from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer

            q = MatMulNBitsQuantizer(onnx.load(str(src)), block_size=32, is_symmetric=True)
            q.process()
            q.model.save_model_to_file(str(out / "onnx" / f"{name}_q4.onnx"), False)
    # On ne publie que les fichiers utilisés par l'app (cf. asr.worker.ts).
    keep = {
        "encoder_model_fp16.onnx",
        "encoder_model_quantized.onnx",
        "decoder_model_merged_quantized.onnx",
    }
    for f in (out / "onnx").iterdir():
        if f.name not in keep:
            f.unlink()
    for f in sorted((out / "onnx").iterdir()):
        print(f"  {f.name:42s} {f.stat().st_size / 1e6:7.1f} Mo")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("model")
    p.add_argument("--base", default=None, help="Whisper d'origine (ex. openai/whisper-base)")
    p.add_argument("--force", action="store_true")
    p.add_argument("--variants", default="fp16", help="formats WebGPU à produire (vide = aucun)")
    a = p.parse_args()
    base = a.base
    if base is None:
        size = next((s for s in ("tiny", "base", "small", "medium") if s in a.model), "base")
        base = f"openai/whisper-{size}"
    out = export(a.model, base, a.force)
    if a.variants:
        variants(out, a.variants.split(","))


if __name__ == "__main__":
    main()
