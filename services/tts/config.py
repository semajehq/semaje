"""TTS service configuration — every knob comes from an env var."""
import os
from pathlib import Path

DEFAULT_VOICE_ROOT = Path(__file__).resolve().parents[2] / "data" / "voices"


def _env(name: str, default: str) -> str:
    value = os.getenv(name)
    return value.strip() if value is not None and value.strip() != "" else default


def _bool(name: str, default: bool) -> bool:
    return _env(name, "true" if default else "false").lower() in ("1", "true", "yes", "on")


VOICE_DIR = Path(_env("TTS_VOICE_DIR", str(DEFAULT_VOICE_ROOT)))
# Operator-supplied voices: <id>.onnx + <id>.onnx.json (Piper format) + optional
# <id>.semaje.json {"language": "kik_Latn", "license": "...", "name": "..."}.
CUSTOM_VOICE_DIR = Path(_env("TTS_CUSTOM_VOICE_DIR", str(VOICE_DIR / "custom")))

# MMS-TTS weights are CC-BY-NC-4.0 (non-commercial). Off unless an operator opts in.
ALLOW_NONCOMMERCIAL = _bool("TTS_ALLOW_NONCOMMERCIAL", False)
# Download a missing Piper/MMS voice on first use. Set false for air-gapped hosts.
AUTO_DOWNLOAD = _bool("TTS_AUTO_DOWNLOAD", True)
USE_CUDA = _bool("TTS_USE_CUDA", False)

MAX_CHARS = int(_env("TTS_MAX_CHARS", "5000"))
CHUNK_CHARS = int(_env("TTS_CHUNK_CHARS", "400"))
MAX_LOADED_VOICES = int(_env("TTS_MAX_LOADED_VOICES", "4"))
MAX_CONCURRENCY = int(_env("TTS_MAX_CONCURRENCY", "2"))
QUEUE_TIMEOUT_SEC = float(_env("TTS_QUEUE_TIMEOUT_SEC", "60"))
API_TOKEN = _env("TTS_API_TOKEN", "")
FFMPEG_BIN = _env("FFMPEG_BIN", "ffmpeg")
LOG_LEVEL = _env("TTS_LOG_LEVEL", "INFO")

HOST = _env("TTS_HOST", "0.0.0.0")
PORT = int(_env("TTS_PORT", "8012"))
