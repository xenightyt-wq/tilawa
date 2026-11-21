import json

import numpy as np
from fastapi.testclient import TestClient

from app.arabic import normalize_word, tokenize, wer
from app.config import SAMPLE_RATE, Settings
from app.engines import FakeEngine
from app.main import build_app
from app.streaming import Segmenter, pcm16_to_float

SR = SAMPLE_RATE


def tone(seconds: float, amp: float = 0.2) -> np.ndarray:
    t = np.arange(int(seconds * SR)) / SR
    # voix "synthétique" : somme d'harmoniques modulée
    sig = sum(np.sin(2 * np.pi * f * t) for f in (180, 360, 540)) / 3
    return (amp * sig * (0.6 + 0.4 * np.sin(2 * np.pi * 3 * t))).astype(np.float32)


def silence(seconds: float, amp: float = 0.001) -> np.ndarray:
    return np.random.default_rng(0).normal(0, amp, int(seconds * SR)).astype(np.float32)


def feed(seg: Segmenter, audio: np.ndarray, chunk_ms: int = 100):
    jobs = []
    step = SR * chunk_ms // 1000
    for k in range(0, len(audio), step):
        jobs += seg.add(audio[k : k + step])
    return jobs


def test_segmenter_partials_then_final():
    seg = Segmenter(Settings(engine="fake"))
    jobs = feed(seg, np.concatenate([silence(0.5), tone(2.0), silence(1.0)]))
    kinds = [j.kind for j in jobs]
    assert kinds.count("final") == 1
    assert kinds[-1] == "final"
    assert 2 <= kinds.count("partial") <= 5
    final = jobs[-1]
    # Le final contient toute la parole + pré-roll + silence de fin
    assert 2.0 <= len(final.audio) / SR <= 3.2
    assert seg.segment == 1


def test_segmenter_two_segments_and_silence_only():
    seg = Segmenter(Settings(engine="fake"))
    assert feed(seg, silence(2.0)) == []
    jobs = feed(seg, np.concatenate([tone(1.0), silence(1.0), tone(1.0), silence(1.0)]))
    finals = [j for j in jobs if j.kind == "final"]
    assert [j.segment for j in finals] == [0, 1]


def test_segmenter_max_length_forces_final():
    seg = Segmenter(Settings(engine="fake", max_segment_ms=3000))
    jobs = feed(seg, tone(7.0))
    assert len([j for j in jobs if j.kind == "final"]) == 2


def test_segmenter_reset_drops_audio():
    seg = Segmenter(Settings(engine="fake"))
    feed(seg, tone(1.0))
    seg.reset()
    assert seg.segment_ms == 0
    jobs = feed(seg, silence(1.0))
    assert jobs == []


def test_pcm16_conversion():
    pcm = (np.array([0, 16384, -32768], dtype="<i2")).tobytes()
    out = pcm16_to_float(pcm)
    assert np.allclose(out, [0, 0.5, -1.0])


def test_arabic_normalization_matches_frontend():
    assert normalize_word("ٱلرَّحْمَـٰنِ") == "الرحمن"
    assert normalize_word("إِيَّاكَ") == "اياك"
    assert tokenize("قُلْ هُوَ ٱللَّهُ أَحَدٌ ۚ") == ["قل", "هو", "الله", "احد"]
    assert wer(["a", "b", "c"], ["a", "c"]) == (1, 3)


def _pcm(audio: np.ndarray) -> bytes:
    return (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()


def test_websocket_stream_with_fake_engine():
    engine = FakeEngine()
    app = build_app(Settings(engine="fake", static_dir="/nonexistent"), engine=engine)
    with TestClient(app) as client:
        assert client.get("/api/health").json()["engine"] == "fake"
        with client.websocket_connect("/ws/asr") as ws:
            assert ws.receive_json()["type"] == "ready"
            audio = np.concatenate([silence(0.3), tone(2.5), silence(1.2)])
            step = SR // 10
            for k in range(0, len(audio), step):
                ws.send_bytes(_pcm(audio[k : k + step]))
            msgs = []
            while True:
                m = ws.receive_json()
                msgs.append(m)
                if m["type"] == "final":
                    break
            types = [m["type"] for m in msgs]
            assert "vad" in types
            final = msgs[-1]
            assert final["segment"] == 0
            assert final["text"].startswith("قل هو الله")
            # Contrôle : reset puis flush sans audio ne produit rien
            ws.send_text(json.dumps({"type": "reset"}))
            ws.send_text(json.dumps({"type": "flush"}))
    assert any(final for _, final in engine.calls)


def test_websocket_rejects_oversized_frame():
    app = build_app(Settings(engine="fake", static_dir="/nonexistent"), engine=FakeEngine())
    with TestClient(app) as client, client.websocket_connect("/ws/asr") as ws:
        ws.receive_json()
        ws.send_bytes(b"\x00" * 100_001)
        assert ws.receive_json()["type"] == "error"
