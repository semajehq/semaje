# services/tts — text-to-speech

Piper by default, MMS-TTS for 1,100 languages when an operator opts into its
non-commercial license, custom voices for everything else. Contract:
[contract.md](contract.md).

```bash
services/tts/setup.sh                 # Piper + two default voices
SEMAJE_MMS=1 services/tts/setup.sh    # + MMS runtime
npm run dev:tts                       # :8012
npm run test:tts                      # gate tests
npm run eval:tts                      # TTS → STT round-trip intelligibility (needs both services)
```

## Measured round trip (TTS → STT CER, 2026-10-12)

| language | voice | CER |
|---|---|---|
| Swahili | piper `sw_CD-lanfrica-medium` | 5.7% |
| English | piper `en_GB-cori-high` | 7.1% |
| Nepali | piper `ne_NP-chitwan-medium` | 9.1% |
| French | piper `fr_FR-mls-medium` | 17.0% (digit normalization) |
| Kikuyu | mms `kik` (non-commercial) | 4.5% |
| Yoruba | mms `yor` (non-commercial) | 7.1% |
| Amharic | mms `amh` (non-commercial) | 18.2% |

Warm Piper synthesis: ~0.1 s for 4 s of speech on an M4 CPU.

## Coverage gap, stated plainly

No open voice exists today for Igbo, Zulu, Xhosa, Wolof, or Luo (neither Piper
nor MMS-TTS ships them). Train a Piper voice (piper1-gpl training recipe, ~1 h of
clean single-speaker audio) and drop it in `TTS_CUSTOM_VOICE_DIR`; semaje picks
it up with no code change.
