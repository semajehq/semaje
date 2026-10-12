"""Gate tests: TTS HTTP surface with a fake synthesizer (no model, no network)."""
import io
import json
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient

import services.tts.app as tts_app
from services.tts import config
from services.tts.engines.base import Audio, Synth


class FakeSynth(Synth):
    engine = "fake"

    def __init__(self, voice):
        self.voice = voice
        self.calls = []

    def load(self):
        pass

    def synthesize(self, chunks, speed=1.0, speaker=None):
        self.calls.append((chunks, speed))
        return Audio(np.zeros(int(22050 * 0.5 * len(chunks)), dtype=np.float32), 22050)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(tts_app, "make_synth", lambda voice: FakeSynth(voice))
    monkeypatch.setattr(tts_app, "installed_ids", lambda: set())
    monkeypatch.setattr(tts_app, "cache", tts_app.SynthCache(2))
    monkeypatch.setattr(config, "API_TOKEN", "")
    monkeypatch.setattr(config, "ALLOW_NONCOMMERCIAL", False)
    return TestClient(tts_app.app)


def test_health(client):
    assert client.get("/health/live").json() == {"ok": True}
    assert client.get("/health").json()["allowNoncommercial"] is False


def test_synthesize_returns_wav_with_provenance_headers(client):
    r = client.post("/synthesize", json={"text": "Habari ya asubuhi. Karibu.", "language": "sw"})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "audio/wav"
    assert r.headers["x-semaje-engine"] == "piper"
    assert r.headers["x-semaje-language"] == "swh_Latn"
    assert json.loads(r.headers["x-semaje-license"])["engine"] == "GPL-3.0-or-later"
    with wave.open(io.BytesIO(r.content)) as wf:
        assert wf.getframerate() == 22050 and wf.getnchannels() == 1


@pytest.mark.parametrize("fmt,mime", [("mp3", "audio/mpeg"), ("ogg", "audio/ogg"), ("flac", "audio/flac")])
def test_compressed_formats(client, fmt, mime):
    r = client.post("/synthesize", json={"text": "Hello there.", "language": "en", "format": fmt})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == mime
    assert len(r.content) > 100


def test_license_gate_is_403(client):
    r = client.post("/synthesize", json={"text": "Wĩ mwega?", "language": "kik"})
    assert r.status_code == 403
    assert r.json()["code"] == "license_noncommercial"


def test_no_voice_is_404(client):
    r = client.post("/synthesize", json={"text": "Kedu?", "language": "ig"})
    assert r.status_code == 404
    assert r.json()["code"] == "no_voice"


@pytest.mark.parametrize("body,code", [
    ({"text": "", "language": "en"}, "invalid_text"),
    ({"text": "hi", "language": "klingon"}, "unknown_language"),
    ({"text": "hi", "language": "en", "format": "aiff"}, "invalid_format"),
])
def test_bad_input_is_400(client, body, code):
    r = client.post("/synthesize", json=body)
    assert r.status_code == 400
    assert r.json()["code"] == code


def test_speed_out_of_range_is_422(client):
    assert client.post("/synthesize", json={"text": "hi", "language": "en", "speed": 9}).status_code == 422


def test_text_limit(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_CHARS", 10)
    r = client.post("/synthesize", json={"text": "this is too long", "language": "en"})
    assert r.status_code == 400 and "TTS_MAX_CHARS" in r.json()["error"]


def test_token_auth(client, monkeypatch):
    monkeypatch.setattr(config, "API_TOKEN", "t0k")
    assert client.post("/synthesize", json={"text": "hi", "language": "en"}).status_code == 401
    assert client.get("/health/live").status_code == 200
    ok = client.post("/synthesize", json={"text": "hi", "language": "en"}, headers={"Authorization": "Bearer t0k"})
    assert ok.status_code == 200


def test_voices_listing_and_filter(client):
    body = client.get("/voices", params={"language": "sw"}).json()
    assert body["count"] >= 1 and all(v["language"] == "swh_Latn" for v in body["voices"])
    assert client.get("/voices", params={"language": "klingon"}).status_code == 400


def test_synth_cache_is_bounded(client):
    for lang in ("en", "fr", "de", "es"):
        assert client.post("/synthesize", json={"text": "hi", "language": lang}).status_code == 200
    assert len(tts_app.cache.items) == 2


def test_metrics(client):
    client.post("/synthesize", json={"text": "hi", "language": "en"})
    assert "semaje_tts_requests_total" in client.get("/metrics").text
