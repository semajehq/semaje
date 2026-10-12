"""Gate tests: the shared language registry contract."""
import json
from collections import Counter

import pytest

from packages.languages import REGISTRY_PATH, Language, UnknownLanguage, registry

R = registry()
DATA = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))


def test_codes_are_unique_and_canonical():
    codes = [l.code for l in R.languages]
    assert len(codes) == len(set(codes))
    for lang in R.languages:
        iso3, script, *variant = lang.code.split("_")
        assert (iso3, script, variant[0] if variant else None) == (lang.iso3, lang.script, lang.variant)
        assert len(iso3) == 3 and iso3.islower()
        assert len(script) == 4 and script[0].isupper()


def test_source_counts_match_upstream():
    assert DATA["sources"]["whisper"] == 100
    assert DATA["sources"]["omnilingual"] >= 1600
    assert DATA["sources"]["mmsTts"] >= 1100
    assert sum(1 for l in R.languages if l.whisper) == 100
    assert sum(1 for l in R.languages if l.omnilingual) == DATA["sources"]["omnilingual"]
    assert DATA["count"] == len(R.languages)


def test_whisper_codes_are_unique():
    counts = Counter(l.whisper for l in R.languages if l.whisper)
    assert [c for c, n in counts.items() if n > 1] == []


@pytest.mark.parametrize("query,code", [
    ("sw", "swh_Latn"), ("swa", "swh_Latn"), ("swh", "swh_Latn"), ("swh_Latn", "swh_Latn"),
    ("SW-ke", "swh_Latn"), ("Swahili", "swh_Latn"), ("Kiswahili", "swh_Latn"),
    ("Kikuyu", "kik_Latn"), ("Dholuo", "luo_Latn"), ("Twi", "aka_Latn"), ("yo", "yor_Latn"),
    ("am", "amh_Ethi"), ("Igbo", "ibo_Latn"), ("zu", "zul_Latn"), ("rw", "kin_Latn"),
    ("en-US", "eng_Latn"), ("pt_BR", "por_Latn"), ("zh", "cmn_Hans"), ("zh-TW", "cmn_Hant"),
    ("zh-Hant-HK", "cmn_Hant"), ("Farsi", "fas_Arab"), ("iw", "heb_Hebr"), ("jw", "jav_Latn"),
    ("Éwé", "ewe_Latn"), ("ewe", "ewe_Latn"),
])
def test_resolve_accepts_every_common_form(query, code):
    assert R.resolve(query).code == code


@pytest.mark.parametrize("empty", [None, "", "  ", "auto", "AUTO"])
def test_resolve_auto_means_none(empty):
    assert R.resolve(empty) is None


@pytest.mark.parametrize("junk", ["klingon", "xx", "zzz_Latn", "../etc/passwd"])
def test_resolve_rejects_unknown(junk):
    with pytest.raises(UnknownLanguage):
        R.resolve(junk)


def test_from_whisper_maps_every_whisper_code():
    for lang in R.languages:
        if lang.whisper:
            assert R.from_whisper(lang.whisper) is lang


def test_low_resource_coverage_floor():
    """Guards the product promise: these languages must stay recognizable."""
    for code in ["swh_Latn", "kik_Latn", "luo_Latn", "yor_Latn", "ibo_Latn", "hau_Latn", "amh_Ethi",
                 "som_Latn", "zul_Latn", "xho_Latn", "kin_Latn", "lug_Latn", "wol_Latn", "tir_Ethi",
                 "aka_Latn", "ewe_Latn", "nya_Latn", "sna_Latn", "lin_Latn", "orm_Latn"]:
        lang = R.get(code)
        assert lang is not None and lang.omnilingual, code


def test_dialect_variants_never_shadow_the_base_language():
    assert R.resolve("ell").code == "ell_Grek"
    assert R.resolve("ell_Grek_cypr1249").variant == "cypr1249"
    assert R.resolve("roh").code == "roh_Latn_surs1244"  # only exists as a variant


def test_to_dict_roundtrip():
    lang = R.get("swh_Latn")
    assert Language.from_row(lang.to_dict()) == lang
