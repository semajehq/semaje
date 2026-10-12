"""Prometheus metrics for the TTS service (GET /metrics)."""
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Histogram, generate_latest

CONTENT_TYPE = CONTENT_TYPE_LATEST
REGISTRY = CollectorRegistry()

REQUESTS = Counter("semaje_tts_requests_total", "Synthesis requests by engine and outcome.",
                   ["engine", "outcome"], registry=REGISTRY)
CHARS = Counter("semaje_tts_characters_total", "Characters synthesized.", ["engine"], registry=REGISTRY)
AUDIO_SECONDS = Counter("semaje_tts_audio_seconds_total", "Seconds of audio produced.", ["engine"], registry=REGISTRY)
LATENCY = Histogram("semaje_tts_synthesis_seconds", "Synthesis wall time.", ["engine"], registry=REGISTRY,
                    buckets=(0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60))
REJECTED = Counter("semaje_tts_rejected_total", "Requests rejected at capacity.", registry=REGISTRY)


def render() -> bytes:
    return generate_latest(REGISTRY)
