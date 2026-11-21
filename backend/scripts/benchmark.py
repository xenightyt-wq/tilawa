"""Compare des modèles Whisper (CTranslate2) pour la correction de récitation.

    uv run python scripts/benchmark.py models/whisper-tiny-ar-quran-ct2 models/whisper-base-ar-quran-ct2 ...

Mesures (audio EveryAyah, mis en cache dans backend/.bench-cache) :
  1. WER par verset (après normalisation), au propre et avec bruit (RSB 10 dB,
     tempo +8 %), et latence de décodage ;
  2. "complétion" : on coupe un verset à 55 % — un bon modèle pour notre usage
     ne doit PAS inventer la fin (sinon il masquerait un oubli) ;
  3. "saut" : on enchaîne le verset n et n+2 — le verset n+1 ne doit pas
     apparaître dans la transcription ;
  4. bruit seul : la transcription doit rester vide.

Attention : les modèles tarteel-ai ont été entraînés sur EveryAyah ; le WER
mesuré ici est donc optimiste. Les tests 2 à 4 restent informatifs.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import cuda_dlls  # noqa: E402
from app.arabic import tokenize, wer  # noqa: E402

CACHE = ROOT / ".bench-cache"
QURAN = ROOT.parent / "frontend" / "public" / "data" / "quran.json"
RECITERS = ["Husary_128kbps", "Minshawy_Murattal_128kbps", "Abdurrahmaan_As-Sudais_192kbps"]
VERSES = [(1, a) for a in range(1, 8)] + [(112, a) for a in range(1, 5)] + [
    (2, 255),
    (67, 1),
    (67, 2),
    (36, 9),
    (18, 10),
]
SKIP_TRIPLES = [(112, 1), (1, 2), (67, 1)]
SR = 16_000


def fetch(reciter: str, sura: int, aya: int) -> np.ndarray:
    from faster_whisper.audio import decode_audio

    f = CACHE / reciter / f"{sura:03d}{aya:03d}.mp3"
    if not f.exists():
        f.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://everyayah.com/data/{reciter}/{f.name}"
        req = urllib.request.Request(url, headers={"User-Agent": "quran-recitation-benchmark"})
        with urllib.request.urlopen(req, timeout=60) as r:
            f.write_bytes(r.read())
    return decode_audio(str(f), sampling_rate=SR)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("models", nargs="+")
    p.add_argument("--device", default="cuda")
    p.add_argument("--compute", default="float16")
    p.add_argument("--json", type=Path)
    a = p.parse_args()

    cuda_dlls.register()
    from faster_whisper import WhisperModel

    q = json.loads(QURAN.read_text(encoding="utf-8"))

    def ref(s: int, v: int) -> list[str]:
        return tokenize(q["verses"][q["suras"][s - 1]["start"] + v - 1][1])

    audio = {(r, s, v): fetch(r, s, v) for r in RECITERS for (s, v) in VERSES}
    for r in RECITERS:
        for s, v in SKIP_TRIPLES:
            for k in range(3):
                audio[(r, s, v + k)] = fetch(r, s, v + k)

    results = []
    for path in a.models:
        model = WhisperModel(path, device=a.device, compute_type=a.compute)
        model.transcribe(np.zeros(SR, dtype=np.float32), language="ar")

        def run(x: np.ndarray, beam: int = 1) -> tuple[list[str], float]:
            t0 = time.perf_counter()
            segs, _ = model.transcribe(
                x,
                language="ar",
                beam_size=beam,
                temperature=0.0,
                condition_on_previous_text=False,
                without_timestamps=True,
            )
            text = " ".join(s.text for s in segs)
            return tokenize(text), (time.perf_counter() - t0) * 1000

        errs = n = 0
        nerrs = 0
        rng = np.random.default_rng(1)
        lat_per_s: list[float] = []
        for r in RECITERS:
            for s, v in VERSES:
                x = audio[(r, s, v)]
                hyp, ms = run(x)
                e, k = wer(ref(s, v), hyp)
                errs += e
                n += k
                lat_per_s.append(ms / (len(x) / SR))
                # Même verset avec bruit ambiant (RSB ~ 10 dB) et léger
                # changement de tempo : approximation d'un micro de téléphone.
                rms = float(np.sqrt(np.mean(x**2)))
                idx = np.arange(0, len(x) - 1, 1.08)
                xs = np.interp(idx, np.arange(len(x)), x).astype(np.float32)
                xs = xs + rng.normal(0, rms / 3.16, len(xs)).astype(np.float32)
                nerrs += wer(ref(s, v), run(xs)[0])[0]
        # 3 s de parole : latence typique d'un partiel
        x3 = audio[(RECITERS[0], 2, 255)][: 3 * SR]
        lat3 = statistics.median(run(x3)[1] for _ in range(5))

        # Complétion inventée sur verset tronqué
        completions = trials = 0
        for r in RECITERS:
            for s, v in VERSES:
                full = ref(s, v)
                if len(full) < 4:
                    continue
                x = audio[(r, s, v)]
                hyp, _ = run(x[: int(len(x) * 0.55)])
                trials += 1
                # La fin du verset (2 derniers mots) ne devrait pas apparaître.
                if hyp[-2:] == full[-2:]:
                    completions += 1

        # Verset sauté réinséré ?
        skip_masked = skip_trials = 0
        for r in RECITERS:
            for s, v in SKIP_TRIPLES:
                x = np.concatenate([audio[(r, s, v)], np.zeros(SR // 2, np.float32), audio[(r, s, v + 2)]])
                hyp, _ = run(x)
                middle = ref(s, v + 1)
                skip_trials += 1
                e, k = wer(middle, hyp[len(ref(s, v)) : len(ref(s, v)) + len(middle)])
                if e <= max(1, k // 4):
                    skip_masked += 1

        noise = np.random.default_rng(0).normal(0, 0.01, 3 * SR).astype(np.float32)
        noise_words = len(run(noise)[0])

        res = {
            "model": Path(path).name,
            "wer": round(100 * errs / n, 2),
            "wer_noisy": round(100 * nerrs / n, 2),
            "latency_3s_ms": round(lat3),
            "rtf_ms_per_s": round(statistics.mean(lat_per_s)),
            "invented_endings": f"{completions}/{trials}",
            "skipped_verse_reinserted": f"{skip_masked}/{skip_trials}",
            "noise_words": noise_words,
        }
        results.append(res)
        print(json.dumps(res, ensure_ascii=False), flush=True)
        del model

    if a.json:
        a.json.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
