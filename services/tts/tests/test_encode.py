"""Gate tests: audio encoding."""
import io
import wave

import numpy as np
import pytest

from services.tts.encode import FormatError, encode, wav_bytes


def test_wav_bytes_clips_and_encodes_16bit_mono():
    data = wav_bytes(np.array([0.0, 2.0, -2.0, 0.5], dtype=np.float32), 16000)
    with wave.open(io.BytesIO(data)) as wf:
        frames = np.frombuffer(wf.readframes(4), dtype="<i2")
        assert (wf.getnchannels(), wf.getsampwidth(), wf.getframerate()) == (1, 2, 16000)
    assert list(frames) == [0, 32767, -32767, 16383]


def test_unknown_format_rejected():
    with pytest.raises(FormatError):
        encode(np.zeros(10, dtype=np.float32), 16000, "exe")
