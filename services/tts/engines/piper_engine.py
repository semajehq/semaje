"""Piper engine (GPL-3.0 engine, ONNX runtime). Runs as its own service process."""
from __future__ import annotations

import shutil
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen

from .base import Audio, Synth, join
from .. import config

PIPER_FILE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/{path}?download=true"


def voice_paths(voice, root: Path) -> tuple[Path, Path]:
    if voice.engine == "custom":
        base = voice.id.split(":", 1)[1]
        return config.CUSTOM_VOICE_DIR / f"{base}.onnx", config.CUSTOM_VOICE_DIR / f"{base}.onnx.json"
    return root / "piper" / f"{voice.id}.onnx", root / "piper" / f"{voice.id}.onnx.json"


def is_installed(voice, root: Path) -> bool:
    model, cfg = voice_paths(voice, root)
    return model.exists() and model.stat().st_size > 0 and cfg.exists()


def download(voice, root: Path) -> None:
    if voice.engine != "piper":
        raise ValueError(f"{voice.id} is not a downloadable Piper voice")
    model, cfg = voice_paths(voice, root)
    model.parent.mkdir(parents=True, exist_ok=True)
    for remote in voice.files:
        target = model if remote.endswith(".onnx") else cfg
        tmp = target.with_suffix(target.suffix + ".part")
        with urlopen(PIPER_FILE_URL.format(path=quote(remote)), timeout=120) as res, open(tmp, "wb") as out:
            shutil.copyfileobj(res, out)
        tmp.replace(target)  # atomic: a half-downloaded voice is never "installed"


class PiperSynth(Synth):
    engine = "piper"

    def __init__(self, voice, root: Path):
        self.voice = voice
        self.root = root
        self._voice = None

    def load(self) -> None:
        if self._voice is not None:
            return
        if not is_installed(self.voice, self.root):
            if not config.AUTO_DOWNLOAD or self.voice.engine != "piper":
                raise FileNotFoundError(f"Voice {self.voice.id} is not installed (TTS_AUTO_DOWNLOAD=false).")
            download(self.voice, self.root)
        from piper import PiperVoice
        model, cfg = voice_paths(self.voice, self.root)
        self._voice = PiperVoice.load(model, config_path=cfg, use_cuda=config.USE_CUDA)

    def synthesize(self, chunks, speed=1.0, speaker=None) -> Audio:
        self.load()
        from piper import SynthesisConfig
        syn = SynthesisConfig(length_scale=1.0 / max(0.25, min(speed, 4.0)), speaker_id=speaker)
        sr = self._voice.config.sample_rate
        parts = []
        for text in chunks:
            for piece in self._voice.synthesize(text, syn_config=syn):
                parts.append(piece.audio_float_array)
        return Audio(join(parts, sr, gap_sec=0.15), sr)
