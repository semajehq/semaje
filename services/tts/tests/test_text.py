"""Gate tests: text cleaning and sentence-aware chunking across scripts."""
import pytest

from services.tts.text import TextError, chunk, clean, split_sentences, validate


def test_clean_strips_control_chars_but_keeps_joiners():
    assert clean("hi\x00 there​\x1b[31m") == "hi there[31m"
    assert clean("می‌خواهم") == "می‌خواهم"  # ZWNJ is meaningful in Persian
    assert clean("  a \t b \n\n c ") == "a b\nc"


def test_validate_limits():
    with pytest.raises(TextError):
        validate("   \n ", 100)
    with pytest.raises(TextError, match="TTS_MAX_CHARS"):
        validate("x" * 101, 100)
    assert validate(" ok ", 100) == "ok"


@pytest.mark.parametrize("text,expected", [
    ("Habari yako? Nzuri sana. Asante!", ["Habari yako?", "Nzuri sana.", "Asante!"]),
    ("ሰላም ነው። እንዴት ነህ፧", ["ሰላም ነው።", "እንዴት ነህ፧"]),                 # Amharic (Ethiopic)
    ("नमस्ते। आप कैसे हैं?", ["नमस्ते।", "आप कैसे हैं?"]),                    # Hindi danda
    ("你好。今天天气很好！", ["你好。", "今天天气很好！"]),                         # CJK, no spaces
    ("کیا حال ہے؟ ٹھیک ہوں۔", ["کیا حال ہے؟", "ٹھیک ہوں۔"]),                 # Urdu
    ('He said "Stop." Then left.', ['He said "Stop."', "Then left."]),
])
def test_split_sentences_multiscript(text, expected):
    assert split_sentences(text) == expected


def test_chunk_packs_sentences_up_to_limit():
    text = " ".join(["Sentence number %d is here." % i for i in range(30)])
    chunks = chunk(text, max_chars=120)
    assert all(len(c) <= 120 for c in chunks)
    assert " ".join(chunks) == text


def test_chunk_cuts_overlong_sentence_at_spaces():
    words = "word " * 200
    chunks = chunk(words.strip(), max_chars=50)
    assert all(len(c) <= 50 for c in chunks)
    assert all(not c.startswith(" ") and not c.endswith(" ") for c in chunks)
    assert " ".join(chunks).split() == words.split()


def test_chunk_handles_scripts_without_spaces():
    thai = "ก" * 1000
    chunks = chunk(thai, max_chars=300)
    assert all(len(c) <= 300 for c in chunks)
    assert "".join(chunks) == thai


def test_chunk_preserves_paragraph_order():
    assert chunk("First para.\nSecond para.", max_chars=400) == ["First para. Second para."]
