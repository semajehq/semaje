"""MMS-TTS engine (Meta, ~1100 languages). Weights are CC-BY-NC-4.0.

Requires requirements-mms.txt (torch, transformers, uroman). Only reachable when
TTS_ALLOW_NONCOMMERCIAL=true; catalog.choose_voice enforces that.
"""
from __future__ import annotations

from pathlib import Path

from .base import Audio, Synth, join
from .. import config


def model_id(voice) -> str:
    return f"facebook/mms-tts-{voice.id.split(':', 1)[1]}"


class MmsSynth(Synth):
    engine = "mms"

    def __init__(self, voice, root: Path):
        self.voice = voice
        self.cache = root / "mms"
        self._model = None
        self._tokenizer = None
        self._uroman = None

    def load(self) -> None:
        if self._model is not None:
            return
        if not config.ALLOW_NONCOMMERCIAL:
            raise PermissionError("MMS-TTS is disabled (TTS_ALLOW_NONCOMMERCIAL=false).")
        from transformers import VitsModel, VitsTokenizer
        kwargs = {"cache_dir": str(self.cache), "local_files_only": not config.AUTO_DOWNLOAD}
        self._tokenizer = VitsTokenizer.from_pretrained(model_id(self.voice), **kwargs)
        self._model = VitsModel.from_pretrained(model_id(self.voice), **kwargs).eval()
        if getattr(self._tokenizer, "is_uroman", False):
            import uroman
            self._uroman = uroman.Uroman()

    def _prepare(self, text: str) -> str:
        # Non-Latin-script MMS vocabularies were trained on uroman romanization;
        # VitsTokenizer applies its own lowercasing/normalization afterwards.
        return self._uroman.romanize_string(text) if self._uroman is not None else text

    def synthesize(self, chunks, speed=1.0, speaker=None) -> Audio:
        self.load()
        import torch
        self._model.speaking_rate = max(0.25, min(speed, 4.0))
        sr = int(self._model.config.sampling_rate)
        parts = []
        for text in chunks:
            inputs = self._tokenizer(self._prepare(text), return_tensors="pt")
            if inputs["input_ids"].shape[-1] == 0:
                continue  # nothing pronounceable in this chunk for this vocabulary
            with torch.no_grad():
                wave = self._model(**inputs).waveform[0].cpu().numpy()
            parts.append(wave)
        return Audio(join(parts, sr), sr)
