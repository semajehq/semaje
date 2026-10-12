"""Regenerate packages/languages/languages.json (+ tts-voices.json).

Sources, all authoritative upstream lists:
  * Whisper           faster_whisper.tokenizer._LANGUAGE_CODES (+ names below)
  * Omnilingual ASR   omnilingual_asr.models.wav2vec2_llama.lang_ids.supported_langs
  * MMS-TTS           https://dl.fbaipublicfiles.com/mms/tts/all-tts-languages.html
  * Piper             https://huggingface.co/rhasspy/piper-voices voices.json + MODEL_CARDs

Needs network plus `pip install langcodes language_data omnilingual-asr faster-whisper`.
Run from the repo root:

    python -m packages.languages.build

The output is deterministic for a given set of upstream lists (sorted, no timestamps).
"""
from __future__ import annotations

import html
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen

import langcodes

HERE = Path(__file__).resolve().parent
MMS_TTS_URL = "https://dl.fbaipublicfiles.com/mms/tts/all-tts-languages.html"
PIPER_VOICES_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/voices.json?download=true"
PIPER_FILE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/{path}?download=true"

# English names for Whisper's language codes (openai/whisper tokenizer.py).
WHISPER_NAMES = {
    "en": "English", "zh": "Chinese", "de": "German", "es": "Spanish", "ru": "Russian", "ko": "Korean",
    "fr": "French", "ja": "Japanese", "pt": "Portuguese", "tr": "Turkish", "pl": "Polish", "ca": "Catalan",
    "nl": "Dutch", "ar": "Arabic", "sv": "Swedish", "it": "Italian", "id": "Indonesian", "hi": "Hindi",
    "fi": "Finnish", "vi": "Vietnamese", "he": "Hebrew", "uk": "Ukrainian", "el": "Greek", "ms": "Malay",
    "cs": "Czech", "ro": "Romanian", "da": "Danish", "hu": "Hungarian", "ta": "Tamil", "no": "Norwegian",
    "th": "Thai", "ur": "Urdu", "hr": "Croatian", "bg": "Bulgarian", "lt": "Lithuanian", "la": "Latin",
    "mi": "Maori", "ml": "Malayalam", "cy": "Welsh", "sk": "Slovak", "te": "Telugu", "fa": "Persian",
    "lv": "Latvian", "bn": "Bengali", "sr": "Serbian", "az": "Azerbaijani", "sl": "Slovenian",
    "kn": "Kannada", "et": "Estonian", "mk": "Macedonian", "br": "Breton", "eu": "Basque",
    "is": "Icelandic", "hy": "Armenian", "ne": "Nepali", "mn": "Mongolian", "bs": "Bosnian",
    "kk": "Kazakh", "sq": "Albanian", "sw": "Swahili", "gl": "Galician", "mr": "Marathi",
    "pa": "Punjabi", "si": "Sinhala", "km": "Khmer", "sn": "Shona", "yo": "Yoruba", "so": "Somali",
    "af": "Afrikaans", "oc": "Occitan", "ka": "Georgian", "be": "Belarusian", "tg": "Tajik",
    "sd": "Sindhi", "gu": "Gujarati", "am": "Amharic", "yi": "Yiddish", "lo": "Lao", "uz": "Uzbek",
    "fo": "Faroese", "ht": "Haitian Creole", "ps": "Pashto", "tk": "Turkmen", "nn": "Nynorsk",
    "mt": "Maltese", "sa": "Sanskrit", "lb": "Luxembourgish", "my": "Myanmar", "bo": "Tibetan",
    "tl": "Tagalog", "mg": "Malagasy", "as": "Assamese", "tt": "Tatar", "haw": "Hawaiian",
    "ln": "Lingala", "ha": "Hausa", "ba": "Bashkir", "jw": "Javanese", "su": "Sundanese",
    "yue": "Cantonese",
}

# Whisper uses macrolanguage codes; Omnilingual/MMS use the individual language
# that is actually spoken. ISO 639-3 macrolanguage → individual language.
MACRO_TO_INDIVIDUAL = {
    "swa": "swh", "zho": "cmn", "ara": "arb", "fas": "pes", "msa": "zsm", "est": "ekk",
    "lav": "lvs", "uzb": "uzn", "nep": "npi", "aze": "azj", "mon": "khk", "sqi": "als",
    "yid": "ydd", "pus": "pbt", "nor": "nob", "mlg": "plt", "kur": "kmr", "orm": "gaz",
    "grn": "gug", "que": "quy", "hbs": "hbs", "kok": "gom", "raj": "raj", "lah": "pnb",
    "zza": "diq", "fil": "tgl",
}
# Whisper codes that are not ISO 639-1/3 or need an explicit target.
WHISPER_ISO3 = {"jw": "jav", "haw": "haw", "yue": "yue", "no": "nob", "nn": "nno", "tl": "tgl",
                "sr": "srp", "bs": "bos", "hr": "hrv", "he": "heb", "zh": "cmn"}
WHISPER_SCRIPT = {"zh": "Hans", "yue": "Hant", "sr": "Cyrl", "pa": "Guru", "sd": "Arab", "uz": "Latn",
                  "az": "Latn", "mn": "Cyrl", "tg": "Cyrl", "tk": "Latn", "kk": "Cyrl", "ms": "Latn",
                  "jw": "Latn", "su": "Latn", "bs": "Latn"}

# Names people actually type that differ from the ISO English name.
COMMON_ALIASES = {
    "swh": ["Kiswahili"], "kik": ["Kikuyu"], "luo": ["Dholuo"], "aka": ["Twi", "Fante", "Asante", "tw"],
    "fas": ["Farsi"], "cmn": ["Mandarin"], "nya": ["Nyanja", "Chewa"], "ful": ["Fula", "Fulani", "Pulaar"],
    "zul": ["isiZulu"], "xho": ["isiXhosa"], "tgl": ["Filipino"], "mya": ["Burmese"], "pan": ["Panjabi"],
    "hat": ["Haitian"], "spa": ["Castilian"], "sot": ["Sesotho"], "tsn": ["Setswana"], "nso": ["Sepedi"],
    "kin": ["Ikinyarwanda"], "lug": ["Luganda"], "orm": ["Afaan Oromo"], "tir": ["Tigrinya"],
    "ewe": ["Ewe"], "ibo": ["Igbo"], "yor": ["Yoruba"], "hau": ["Hausa"], "khk": ["Mongolian"],
    "ell": ["Greek"], "nob": ["Norwegian", "Bokmal"], "zsm": ["Malay"], "arb": ["Arabic"],
    # Deprecated ISO 639-1 codes still emitted by older software.
    "heb": ["iw"], "ind": ["in"], "ydd": ["ji"],
}
SCRIPT_LABELS = {"Hant": "Traditional", "Hans": "Simplified", "Cyrl": "Cyrillic", "Latn": "Latin",
                 "Arab": "Arabic", "Deva": "Devanagari", "Ethi": "Ge'ez", "Hebr": "Hebrew", "Grek": "Greek"}

SCRIPT_WORDS = {
    "latin": "Latn", "cyrillic": "Cyrl", "arabic": "Arab", "devanagari": "Deva", "bengali": "Beng",
    "gurmukhi": "Guru", "ethiopic": "Ethi", "tamil": "Taml", "telugu": "Telu", "kannada": "Knda",
    "malayalam": "Mlym", "gujarati": "Gujr", "oriya": "Orya", "thai": "Thai", "georgian": "Geor",
    "armenian": "Armn", "hebrew": "Hebr", "greek": "Grek", "khmer": "Khmr", "lao": "Laoo",
    "myanmar": "Mymr", "tibetan": "Tibt", "sinhala": "Sinh", "han": "Hani", "hangul": "Hang",
}


def fetch(url: str) -> bytes:
    with urlopen(url, timeout=60) as res:
        return res.read()


def default_script(iso3: str) -> str:
    try:
        script = langcodes.Language.get(iso3).maximize().script
    except (langcodes.LanguageTagError, ValueError):
        script = None
    return script or "Zyyy"


def english_name(tag: str) -> str | None:
    try:
        lang = langcodes.Language.get(tag)
        name = lang.language_name("en")
    except (langcodes.LanguageTagError, ValueError, LookupError):
        return None
    if not name or name == tag or name.startswith("Unknown"):
        return None
    return name


def iso1_of(iso3: str) -> str | None:
    try:
        code = langcodes.Language.get(iso3).language
    except (langcodes.LanguageTagError, ValueError):
        return None
    return code if code and len(code) == 2 else None


def load_omnilingual() -> list[str]:
    from omnilingual_asr.models.wav2vec2_llama.lang_ids import supported_langs
    return sorted(set(supported_langs))


def load_whisper() -> list[str]:
    from faster_whisper.tokenizer import _LANGUAGE_CODES
    codes = sorted(_LANGUAGE_CODES)
    missing = set(codes) ^ set(WHISPER_NAMES)
    if missing:
        sys.exit(f"Whisper language set drifted from WHISPER_NAMES: {sorted(missing)}")
    return codes


def load_mms() -> dict[str, str]:
    """{"swh": "Swahili", "azj-script_latin": "Azerbaijani, North", ...}"""
    page = fetch(MMS_TTS_URL).decode("utf-8")
    out = {}
    for code, name in re.findall(r"<p>\s*([a-z]{3}(?:-script_[a-z]+)?)\s*&emsp;\s*(.*?)\s*</p>", page):
        out[code] = html.unescape(name)
    if len(out) < 1000:
        sys.exit(f"MMS-TTS list parse looks wrong: only {len(out)} languages")
    return out


def mms_canonical(mms_id: str) -> str:
    iso3, _, script_word = mms_id.partition("-script_")
    script = SCRIPT_WORDS.get(script_word) if script_word else default_script(iso3)
    return f"{iso3}_{script or default_script(iso3)}"


def parse_model_card(text: str) -> dict:
    url = re.search(r"\*\s*URL:\s*(\S+)", text)
    lic = re.search(r"\*\s*License:\s*(.+)", text)
    return {
        "datasetUrl": url.group(1).strip() if url else None,
        "datasetLicense": lic.group(1).strip() if lic else None,
    }


def load_piper() -> list[dict]:
    voices = json.loads(fetch(PIPER_VOICES_URL))

    def card(voice: dict) -> dict:
        path = next((p for p in voice["files"] if p.endswith("MODEL_CARD")), None)
        try:
            return parse_model_card(fetch(PIPER_FILE_URL.format(path=quote(path))).decode("utf-8")) if path else {}
        except OSError:
            return {}

    with ThreadPoolExecutor(max_workers=16) as pool:
        cards = list(pool.map(card, voices.values()))

    rows = []
    for voice, meta in zip(voices.values(), cards):
        onnx = next(p for p in voice["files"] if p.endswith(".onnx"))
        rows.append({
            "id": voice["key"],
            "engine": "piper",
            "locale": voice["language"]["code"],
            "family": voice["language"]["family"],
            "languageName": voice["language"]["name_english"],
            "country": voice["language"].get("country_english"),
            "quality": voice["quality"],
            "speakers": voice.get("num_speakers", 1),
            "sizeBytes": voice["files"][onnx]["size_bytes"],
            "files": sorted(p for p in voice["files"] if p.endswith((".onnx", ".onnx.json"))),
            "license": {
                "engine": "GPL-3.0-or-later",
                "dataset": meta.get("datasetLicense"),
                "datasetUrl": meta.get("datasetUrl"),
                "commercialUse": "verify",
            },
        })
    return sorted(rows, key=lambda r: r["id"])


def piper_canonical(family: str, by_whisper: dict[str, str]) -> str:
    if family in by_whisper:
        return by_whisper[family]
    iso3 = langcodes.Language.get(family).to_alpha3()
    iso3 = MACRO_TO_INDIVIDUAL.get(iso3, iso3)
    return f"{iso3}_{default_script(iso3)}"


def main() -> None:
    omni = load_omnilingual()
    whisper = load_whisper()
    mms = load_mms()
    piper = load_piper()

    entries: dict[str, dict] = {}

    def entry(code: str) -> dict:
        if code not in entries:
            iso3, script, *rest = code.split("_")
            entries[code] = {
                "code": code, "iso3": iso3, "script": script, "variant": rest[0] if rest else None,
                "name": None, "iso1": iso1_of(iso3),
                "whisper": None, "omnilingual": False, "mmsTts": None, "piper": [], "aliases": [],
            }
        return entries[code]

    for code in omni:
        entry(code)["omnilingual"] = True

    omni_by_iso3: dict[str, list[str]] = {}
    for code in omni:
        if code.count("_") == 1:  # dialect variants (ell_Grek_cypr1249) never stand in for the base language
            omni_by_iso3.setdefault(code.split("_")[0], []).append(code)

    by_whisper: dict[str, str] = {}
    unmatched = []
    for wcode in whisper:
        macro = langcodes.Language.get(wcode).to_alpha3() if wcode not in WHISPER_ISO3 else WHISPER_ISO3[wcode]
        # Prefer the individual language; Omnilingual sometimes keeps the macro code (fas, aze, lav, nep).
        code = None
        for iso3 in dict.fromkeys((MACRO_TO_INDIVIDUAL.get(macro, macro), macro)):
            script = WHISPER_SCRIPT.get(wcode) or default_script(iso3)
            candidate = f"{iso3}_{script}"
            if candidate not in entries and len(omni_by_iso3.get(iso3, [])) == 1:
                candidate = omni_by_iso3[iso3][0]
            if candidate in entries:
                code = candidate
                break
        if code is None:
            iso3 = MACRO_TO_INDIVIDUAL.get(macro, macro)
            code = f"{iso3}_{WHISPER_SCRIPT.get(wcode) or default_script(iso3)}"
        if code not in entries:
            unmatched.append(f"{wcode}->{code}")
        e = entry(code)
        e["whisper"] = wcode
        e["name"] = WHISPER_NAMES[wcode]
        if len(wcode) == 2:
            e["iso1"] = wcode if wcode not in ("jw",) else "jv"
        by_whisper[wcode] = code

    for mms_id, name in mms.items():
        code = mms_canonical(mms_id)
        iso3 = code.split("_")[0]
        if code not in entries and not mms_id.count("-script_") and len(omni_by_iso3.get(iso3, [])) == 1:
            code = omni_by_iso3[iso3][0]
        e = entry(code)
        e["mmsTts"] = mms_id
        e["aliases"].append(name)

    for voice in piper:
        code = piper_canonical(voice["family"], by_whisper)
        if code not in entries and len(omni_by_iso3.get(code.split("_")[0], [])) == 1:
            code = omni_by_iso3[code.split("_")[0]][0]
        voice["language"] = code
        e = entry(code)
        e["piper"].append(voice["id"])
        e["aliases"].append(voice["languageName"])

    individual_to_macro = {ind: macro for macro, ind in MACRO_TO_INDIVIDUAL.items() if macro != ind}
    for e in entries.values():
        # Name precedence: Whisper's name, then the ISO English name, then upstream list names.
        if not e["name"]:
            e["name"] = english_name(e["iso3"]) or (e["aliases"][0] if e["aliases"] else e["code"])
        extra = list(COMMON_ALIASES.get(e["iso3"], []))
        if e["iso3"] in individual_to_macro:
            extra.append(individual_to_macro[e["iso3"]])
        e["aliases"] = sorted({a for a in e["aliases"] + extra if a and a != e["name"]})
        if e["variant"]:
            e["name"] = f"{e['name']} ({e['variant']})"
        elif e["script"] != default_script(e["iso3"]) and sum(1 for x in entries.values() if x["iso3"] == e["iso3"]) > 1:
            e["name"] = f"{e['name']} ({SCRIPT_LABELS.get(e['script'], e['script'])})"
        e["piper"] = sorted(e["piper"])

    # Order: Whisper languages first (most familiar), then by name. For a bare
    # iso3 alias with multiple scripts, the earlier (more common) one wins.
    rows = sorted(entries.values(), key=lambda e: (e["whisper"] is None, e["variant"] is not None,
                                                   e["name"].lower(), e["code"]))

    out = {
        "version": 1,
        "generatedBy": "python -m packages.languages.build",
        "sources": {
            "whisper": len(whisper), "omnilingual": len(omni), "mmsTts": len(mms), "piperVoices": len(piper),
        },
        "count": len(rows),
        "languages": rows,
    }
    (HERE / "languages.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (HERE / "tts-voices.json").write_text(json.dumps({
        "version": 1, "generatedBy": "python -m packages.languages.build", "piper": piper,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"languages={len(rows)} whisper={len(whisper)} omnilingual={len(omni)} "
          f"mms={len(mms)} piper={len(piper)}")
    if unmatched:
        print("Whisper languages without an Omnilingual match (kept as Whisper-only):", ", ".join(unmatched))


if __name__ == "__main__":
    main()
