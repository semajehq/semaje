"""Text preparation for synthesis. Pure functions, gate-tested."""
from __future__ import annotations

import re
import unicodedata

# Sentence enders across scripts: Latin/Cyrillic, Ethiopic (።፧፨), Devanagari/Bengali
# danda (। ॥), Arabic/Urdu (؟ ۔), CJK full-width (。！？), Armenian (։), Myanmar (။).
_SENTENCE_END = r"[.!?…。！？።፧፨।॥؟۔։။]"
_CLOSERS = r"[\"'”’»)\]]"
# Split on whitespace after a sentence end, keeping any closing quote/bracket with
# the sentence; CJK enders split even without whitespace.
_SPLIT = re.compile(rf"(?:(?<={_SENTENCE_END})|(?<={_SENTENCE_END}{_CLOSERS}))\s+|(?<=[。！？])(?!{_CLOSERS})")


class TextError(ValueError):
    status = 400
    code = "invalid_text"


def clean(text: str) -> str:
    """NFC-normalize, drop control/format characters except newlines, collapse whitespace."""
    text = unicodedata.normalize("NFC", text or "")
    text = "".join(
        ch for ch in text
        if ch in "\n\t" or unicodedata.category(ch)[0] != "C" or ch in "‌‍"  # keep ZWNJ/ZWJ (Indic, Persian)
    )
    return re.sub(r"[ \t\r\f\v]+", " ", re.sub(r"\s*\n\s*", "\n", text)).strip()


def validate(text: str, max_chars: int) -> str:
    text = clean(text)
    if not text:
        raise TextError("Text is empty.")
    if len(text) > max_chars:
        raise TextError(f"Text is {len(text)} characters; the limit is {max_chars} (TTS_MAX_CHARS).")
    return text


def split_sentences(text: str) -> list[str]:
    out = []
    for paragraph in text.split("\n"):
        out.extend(p.strip() for p in _SPLIT.split(paragraph) if p and p.strip())
    return out


def chunk(text: str, max_chars: int = 400) -> list[str]:
    """Sentence-aware chunks no longer than max_chars.

    Sentences are packed greedily; an over-long sentence is cut at the last
    space (or comma) before the limit, and as a last resort mid-word for
    scripts without spaces (Thai, CJK).
    """
    chunks: list[str] = []
    current = ""
    for sentence in split_sentences(text):
        while len(sentence) > max_chars:
            window = sentence[:max_chars]
            cut = max(window.rfind(", "), window.rfind(" "))
            cut = cut if cut > max_chars // 3 else max_chars
            piece, sentence = sentence[:cut].strip(), sentence[cut:].strip(" ,")
            if current:
                chunks.append(current)
                current = ""
            chunks.append(piece)
        if not sentence:
            continue
        if current and len(current) + 1 + len(sentence) > max_chars:
            chunks.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        chunks.append(current)
    return chunks
