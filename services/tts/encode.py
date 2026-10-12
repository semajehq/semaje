"""Encode synthesized audio. WAV is pure Python; other formats go through ffmpeg."""
from __future__ import annotations

import io
import subprocess
import wave

from . import config

FORMATS = {
    "wav": ("audio/wav", None),
    "mp3": ("audio/mpeg", ["-c:a", "libmp3lame", "-q:a", "4", "-f", "mp3"]),
    "ogg": ("audio/ogg", ["-c:a", "libopus", "-b:a", "48k", "-f", "ogg"]),
    "webm": ("audio/webm", ["-c:a", "libopus", "-b:a", "48k", "-f", "webm"]),
    "flac": ("audio/flac", ["-c:a", "flac", "-f", "flac"]),
}


class FormatError(ValueError):
    status = 400
    code = "invalid_format"


def wav_bytes(samples, sample_rate: int) -> bytes:
    import numpy as np

    pcm = (np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


def encode(samples, sample_rate: int, fmt: str) -> tuple[bytes, str]:
    fmt = (fmt or "wav").lower()
    if fmt not in FORMATS:
        raise FormatError(f"Unsupported format {fmt!r}; use one of {', '.join(FORMATS)}.")
    mime, args = FORMATS[fmt]
    data = wav_bytes(samples, sample_rate)
    if args is None:
        return data, mime
    out = subprocess.run(
        [config.FFMPEG_BIN, "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "wav", "-i", "pipe:0", *args, "pipe:1"],
        input=data, capture_output=True, check=True, timeout=120,
    )
    return out.stdout, mime
