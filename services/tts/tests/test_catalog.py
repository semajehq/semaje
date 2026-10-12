"""Gate tests: voice selection + license gating. Pure."""
import json

import pytest

from services.tts import catalog
from services.tts.catalog import LicenseBlocked, VoiceError, choose_voice


def piper():
    return list(catalog.piper_voices())


def test_catalog_has_piper_voices_with_license_metadata():
    voices = piper()
    assert len(voices) >= 150
    for v in voices:
        assert v.license["engine"] == "GPL-3.0-or-later"
        assert v.license["commercialUse"] == "verify"
        assert v.files and all(f.startswith(v.locale.split("_")[0] + "/") for f in v.files)


def test_swahili_gets_a_commercial_piper_voice():
    v = choose_voice("sw", None, piper(), allow_noncommercial=False)
    assert v.engine == "piper" and v.language == "swh_Latn"


def test_region_preference():
    gb = choose_voice("en-GB", None, piper(), allow_noncommercial=False)
    us = choose_voice("en-US", None, piper(), allow_noncommercial=False)
    assert gb.locale == "en_GB" and us.locale == "en_US"


def test_highest_quality_wins_when_nothing_is_installed():
    voices = [v for v in piper() if v.locale == "en_US"]
    assert choose_voice("en-US", None, voices, allow_noncommercial=False).quality == "high"


def test_installed_voice_beats_better_uninstalled_one():
    """An installed voice answers now; a better one would mean a download inside the request."""
    voices = [v for v in piper() if v.locale == "en_US"]
    low = next(v for v in voices if v.quality == "low")
    assert choose_voice("en-US", None, voices, allow_noncommercial=False, installed={low.id}).id == low.id


def test_low_resource_language_without_commercial_voice_is_license_blocked():
    with pytest.raises(LicenseBlocked) as exc:
        choose_voice("kik", None, piper(), allow_noncommercial=False)
    assert exc.value.status == 403
    assert "TTS_ALLOW_NONCOMMERCIAL" in exc.value.message


def test_noncommercial_opt_in_unlocks_mms():
    v = choose_voice("kik", None, piper(), allow_noncommercial=True)
    assert (v.engine, v.id, v.language) == ("mms", "mms:kik", "kik_Latn")
    assert v.noncommercial


def test_language_with_no_voice_anywhere_is_404_with_guidance():
    with pytest.raises(VoiceError) as exc:
        choose_voice("ig", None, piper(), allow_noncommercial=True)  # Igbo: not in MMS-TTS or Piper
    assert exc.value.status == 404
    assert "TTS_CUSTOM_VOICE_DIR" in exc.value.message


def test_explicit_mms_voice_requires_opt_in():
    with pytest.raises(LicenseBlocked):
        choose_voice(None, "mms:swh", piper(), allow_noncommercial=False)
    assert choose_voice(None, "mms:swh", piper(), allow_noncommercial=True).engine == "mms"


def test_unknown_voice_and_missing_language():
    with pytest.raises(VoiceError):
        choose_voice(None, "nope-voice-x", piper(), allow_noncommercial=False)
    with pytest.raises(VoiceError):
        choose_voice(None, None, piper(), allow_noncommercial=False)


def test_custom_voice_beats_everything(tmp_path, monkeypatch):
    for suffix in (".onnx", ".onnx.json"):
        (tmp_path / f"kikuyu-mumbi{suffix}").write_bytes(b"x")
    (tmp_path / "kikuyu-mumbi.semaje.json").write_text(json.dumps(
        {"language": "Kikuyu", "name": "Mumbi", "license": "CC-BY-4.0", "commercialUse": "yes"}))
    (tmp_path / "broken.semaje.json").write_text("{not json")
    (tmp_path / "orphan.semaje.json").write_text(json.dumps({"language": "sw"}))  # no model files
    customs = catalog.custom_voices(tmp_path)
    assert [v.id for v in customs] == ["custom:kikuyu-mumbi"]
    v = choose_voice("kik", None, customs + piper(), allow_noncommercial=False)
    assert v.id == "custom:kikuyu-mumbi" and v.language == "kik_Latn"


def test_mms_voices_only_listed_when_allowed():
    assert not any(v.engine == "mms" for v in catalog.all_voices(allow_noncommercial=False))
    mms = [v for v in catalog.all_voices(allow_noncommercial=True) if v.engine == "mms"]
    assert len(mms) >= 1000
