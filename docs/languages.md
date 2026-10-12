# Languages and accuracy

semaje recognizes speech in **1,693 languages** and speaks in about **1,100**
(58 with commercially licensed voices out of the box). This page explains how a
language is handled, what accuracy to expect, and how to improve it.

## How a language is handled

Every request names a language in any common form (`sw`, `swa`, `swh_Latn`,
`sw-KE`, `Swahili`, `Kiswahili`) or leaves it on auto-detect. The shared
registry (`packages/languages`) resolves it to one canonical code
(`swh_Latn`), and the STT service routes it:

```
language given?
├─ yes ─ Whisper handles it well? (≤ ~15% WER on FLEURS) ── yes → Whisper
│                                                         └ no  → Omnilingual ASR
└─ no  ─ Whisper language ID, confident and a strong language? ── yes → Whisper
                                                                └ no  → Omnilingual ASR
translation to English → always Whisper
```

The "strong" list (`STT_WHISPER_STRONG`) defaults to: English, Spanish, Italian,
Portuguese, German, Japanese, Russian, Polish, French, Catalan, Dutch, Turkish,
Korean, Ukrainian, Indonesian, Swedish, Vietnamese, Czech, Finnish, Norwegian,
Danish, Greek, Romanian, Hungarian, Malay, Chinese, Galician, Slovak, Bulgarian,
and Croatian. Users can force an engine per request (`engine=whisper|omnilingual`)
or per deployment (`STT_ROUTING`).

| | Whisper | Omnilingual ASR |
|---|---|---|
| Languages | 99 | 1,672 |
| Timestamps | word-level | segment-level (silence-chunked, ≤30 s) |
| Confidence scores | yes | no |
| Translate to English | yes | no |
| License | MIT | Apache-2.0 |

## Measured accuracy

Google FLEURS test set (CC-BY-4.0), 5 utterances per language, **smallest
models on a laptop CPU** (Apple M4): Whisper `base` int8 and
`omniASR_CTC_300M_v2`. CER is character error rate, the fairer metric for
agglutinative and non-Latin languages.

| Language | Served by | CER | WER | Whisper-only CER | Speed (RTF) |
|---|---|---|---|---|---|
| English | Whisper | 2.8% | 7.9% | 2.8% | 0.20 |
| Swahili | Omnilingual | 4.9% | 22.4% | 24.3% | 0.09 |
| Luganda | Omnilingual | 4.9% | 46.5% | not supported | 0.15 |
| Luo (Dholuo) | Omnilingual | 6.9% | 40.3% | not supported | 0.23 |
| Amharic | Omnilingual | 11.6% | 35.3% | 148% | 0.10 |
| Yoruba | Omnilingual | 26.1% | 69.0% | 51.5% | 0.11 |

RTF below 1.0 means faster than real time. Larger models are substantially more
accurate. On a GPU, use Whisper `large-v3-turbo` and `omniASR_LLM_1B_v2` (or
`_3B_v2` / `_7B_v2`); the LLM variants also accept the language as a hint.
Yoruba's tone marks are the hardest case for the smallest model; the LLM cards
handle them far better.

Reproduce, or test your own languages:

```bash
npm run dev:stt
npm run eval:fleurs -- --langs sw_ke,yo_ng,am_et,luo_ke,lg_ug,ha_ng,zu_za --n 10 --engines auto,whisper
```

The eval fails if any language regresses past `services/stt/evals/fleurs_thresholds.json`,
or if `auto` ever does worse than forced Whisper on a language where both ran.

## Choosing models

| Hardware | Whisper | Omnilingual | Notes |
|---|---|---|---|
| CPU, 8 GB | `base` | `omniASR_CTC_300M_v2` | default; everything faster than real time |
| CPU, 16 GB | `small` | `omniASR_CTC_1B_v2` | better accuracy, ~2× slower |
| GPU 8 GB | `large-v3-turbo` | `omniASR_LLM_1B_v2` | workstation profile |
| GPU 16 GB+ | `large-v3` | `omniASR_LLM_3B_v2` | server profile |
| GPU 24 GB+ | `large-v3` | `omniASR_LLM_7B_v2` | highest accuracy for low-resource languages |

Switch models live in **Platform → Model workshop**, or with
`STT_WHISPER_MODEL` / `STT_OMNILINGUAL_MODEL`.

## Text-to-speech coverage

| Source | Languages | License | Enabled |
|---|---|---|---|
| Piper | 58 locales, incl. Swahili, Nepali, Hindi, Bengali, Urdu, Kurdish, Telugu, Malayalam | GPL-3.0 engine; dataset license per voice | default |
| MMS-TTS | ~1,100, incl. Kikuyu, Yoruba, Amharic, Hausa, Luganda, Somali, Kinyarwanda, Tigrinya, Akan, Ewe | **CC-BY-NC-4.0** (non-commercial) | `TTS_ALLOW_NONCOMMERCIAL=true` |
| Custom voices | anything you train | yours | drop files in `TTS_CUSTOM_VOICE_DIR` |

Intelligibility, measured by synthesizing a sentence and recognizing it with the
STT service (CER):

| Language | Voice | CER |
|---|---|---|
| Kikuyu | MMS-TTS | 4.5% |
| Swahili | Piper `sw_CD-lanfrica-medium` | 5.7% |
| English | Piper `en_GB-cori-high` | 7.1% |
| Yoruba | MMS-TTS | 7.1% |
| Nepali | Piper `ne_NP-chitwan-medium` | 9.1% |
| French | Piper `fr_FR-mls-medium` | 17.0% |
| Amharic | MMS-TTS | 18.2% |

**Known gap.** No open voice exists yet for Igbo, Zulu, Xhosa, Wolof, or Luo:
recognition works, speech output does not. Training a Piper voice needs about
an hour of clean, consented, single-speaker recordings; add it as a custom voice
(`<id>.onnx`, `<id>.onnx.json`, and `<id>.semaje.json` naming the language)
and semaje uses it automatically.

## Improving accuracy for your domain

- **Glossary**: Library → Glossary maps frequent misrecognitions (names,
  products, local terms) to the right spelling on every transcript.
- **Name the language** instead of auto-detect for short or code-switched audio.
- **`enhance`** (noise reduction + loudness) for field and phone recordings.
- **Bigger models** (above) are the single largest lever.
