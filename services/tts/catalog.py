"""Voice catalog + selection. Selection is pure and gate-tested.

Three voice sources, each with its license recorded:

* piper   — Piper voices (engine GPL-3.0; each voice's dataset license varies,
            see license.dataset). Commercial-safe default.
* custom  — operator-supplied Piper-format voices for languages nobody ships
            (train one for Kikuyu, drop it in TTS_CUSTOM_VOICE_DIR).
* mms     — Meta MMS-TTS, ~1100 languages. Weights are CC-BY-NC-4.0, so it is
            only offered when TTS_ALLOW_NONCOMMERCIAL=true.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from functools import lru_cache
from pathlib import Path

from packages.languages import Language, UnknownLanguage, registry

from . import config

CATALOG_PATH = Path(__file__).resolve().parents[2] / "packages" / "languages" / "tts-voices.json"
QUALITY_RANK = {"high": 0, "medium": 1, "low": 2, "x_low": 3}
MMS_LICENSE = {
    "engine": "MIT (transformers VITS: Apache-2.0)",
    "weights": "CC-BY-NC-4.0",
    "url": "https://github.com/facebookresearch/fairseq/tree/main/examples/mms",
    "commercialUse": "no",
}


class VoiceError(Exception):
    status = 404
    code = "no_voice"

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class LicenseBlocked(VoiceError):
    status = 403
    code = "license_noncommercial"


@dataclass
class Voice:
    id: str
    engine: str                 # piper | custom | mms
    language: str               # canonical code
    name: str
    quality: str = "medium"
    locale: str | None = None
    speakers: int = 1
    size_bytes: int = 0
    license: dict = field(default_factory=dict)
    files: list = field(default_factory=list)

    @property
    def noncommercial(self) -> bool:
        return self.license.get("commercialUse") == "no"

    def to_dict(self) -> dict:
        d = asdict(self)
        d["sizeBytes"] = d.pop("size_bytes")
        d["noncommercial"] = self.noncommercial
        return d


@lru_cache(maxsize=1)
def piper_voices() -> tuple[Voice, ...]:
    data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return tuple(
        Voice(
            id=v["id"], engine="piper", language=v["language"], name=v["id"].split("-")[1],
            quality=v["quality"], locale=v["locale"], speakers=v["speakers"], size_bytes=v["sizeBytes"],
            license=v["license"], files=v["files"],
        )
        for v in data["piper"]
    )


def custom_voices(directory: Path | None = None) -> list[Voice]:
    """Scan the operator's custom voice dir. Each voice needs a <id>.semaje.json naming its language."""
    root = directory or config.CUSTOM_VOICE_DIR
    voices = []
    if not root.is_dir():
        return voices
    for meta_path in sorted(root.glob("*.semaje.json")):
        voice_id = meta_path.name[: -len(".semaje.json")]
        if not (root / f"{voice_id}.onnx").exists() or not (root / f"{voice_id}.onnx.json").exists():
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            lang = registry().resolve(meta["language"])
        except (OSError, ValueError, KeyError, UnknownLanguage):
            continue
        if lang is None:
            continue
        voices.append(Voice(
            id=f"custom:{voice_id}", engine="custom", language=lang.code, name=meta.get("name", voice_id),
            quality=meta.get("quality", "medium"),
            license={"dataset": meta.get("license"), "commercialUse": meta.get("commercialUse", "verify")},
            files=[f"{voice_id}.onnx", f"{voice_id}.onnx.json"],
        ))
    return voices


def mms_voice(lang: Language) -> Voice | None:
    if not lang.mms_tts:
        return None
    return Voice(id=f"mms:{lang.mms_tts}", engine="mms", language=lang.code, name=f"MMS {lang.name}",
                 quality="medium", license=dict(MMS_LICENSE))


def all_voices(allow_noncommercial: bool | None = None) -> list[Voice]:
    allow = config.ALLOW_NONCOMMERCIAL if allow_noncommercial is None else allow_noncommercial
    voices = [*custom_voices(), *piper_voices()]
    if allow:
        voices += [v for lang in registry().languages if (v := mms_voice(lang))]
    return voices


def _region(raw: str | None) -> str | None:
    if not raw:
        return None
    parts = raw.replace("_", "-").split("-")
    return next((p.upper() for p in parts[1:] if len(p) == 2), None)


def choose_voice(
    language: str | None,
    voice_id: str | None,
    voices: list[Voice],
    allow_noncommercial: bool,
    installed: set[str] | None = None,
) -> Voice:
    """Pick the voice for a request. Deterministic given its inputs."""
    installed = installed or set()
    if voice_id:
        if voice_id.startswith("mms:"):
            lang = registry().resolve(voice_id[4:])
            found = mms_voice(lang) if lang else None
        else:
            found = next((v for v in voices if v.id == voice_id), None)
        if found is None:
            raise VoiceError(f"Unknown voice {voice_id!r}. GET /voices lists the available voices.")
        if found.noncommercial and not allow_noncommercial:
            raise LicenseBlocked(
                f"Voice {voice_id} uses non-commercial (CC-BY-NC-4.0) weights. "
                "An operator must set TTS_ALLOW_NONCOMMERCIAL=true to enable it."
            )
        return found

    lang = registry().resolve(language)
    if lang is None:
        raise VoiceError("Pass a language (e.g. 'sw', 'kik', 'yo') or a voice id.")
    region = _region(language)

    def rank(v: Voice):
        return (
            {"custom": 0, "piper": 1, "mms": 2}.get(v.engine, 3),
            0 if region and v.locale and v.locale.endswith(f"_{region}") else 1,
            0 if v.id in installed else 1,
            QUALITY_RANK.get(v.quality, 9),
            v.id,
        )

    candidates = sorted((v for v in voices if v.language == lang.code), key=rank)
    commercial = [v for v in candidates if not v.noncommercial]
    if commercial:
        return commercial[0]
    if allow_noncommercial:
        if candidates:
            return candidates[0]
        mms = mms_voice(lang)
        if mms:
            return mms
    mms = mms_voice(lang)
    if mms:
        raise LicenseBlocked(
            f"No commercially licensed voice exists for {lang.name}. MMS-TTS covers it under a "
            "non-commercial license; set TTS_ALLOW_NONCOMMERCIAL=true to use it, or add a custom voice."
        )
    raise VoiceError(
        f"No voice is available for {lang.name} ({lang.code}). Add a Piper-format voice to "
        "TTS_CUSTOM_VOICE_DIR with a .semaje.json naming this language."
    )
