# semaje

**Open-source speech-to-text and text-to-speech for 1,600+ languages, on your
own infrastructure.**

semaje turns any recording (meetings, interviews, phone voice notes, lectures,
broadcast video) into searchable, shareable transcripts, and brings dictation,
live captions, and read-aloud to every web page through its browser extension.
It runs only open-source models, so it works without any hosted AI service,
including fully air-gapped.

## Highlights

- **Every language that matters to you.** Whisper for the 30 or so languages
  it handles best; Meta's Omnilingual ASR for 1,672 languages, including
  Swahili, Kikuyu, Luo, Yoruba, Amharic, Hausa, Luganda, Somali, Zulu, and
  hundreds more. Routing is automatic and measured: [Languages](languages.md).
- **Any audio.** Every common audio and video format, from 8 kHz phone audio to
  96 kHz studio masters and 5.1 surround (dialogue-weighted downmix), with
  optional noise reduction.
- **Speech out, too.** Piper voices by default; MMS-TTS for about 1,100 more
  languages when an operator accepts its non-commercial license; custom voices
  for anything else.
- **Everywhere you type.** The browser extension for Chrome, Edge, Brave, Opera,
  Vivaldi, Arc, Firefox, and Safari: [semaje-extension](https://github.com/semajehq/semaje-extension).
- **Built for organizations.** SSO, scoped API keys, tenancy, audit trails,
  retention, Prometheus metrics, request tracing, readiness probes, and
  back-pressure under load.

## Quick start

```bash
git clone https://github.com/semajehq/semaje
cd semaje
cp .env.example .env
deploy/semaje cpu up
open http://localhost:8080
```

| Profile | Hardware | Speech models |
|---|---|---|
| `cpu` | 4 cores, 8 GB RAM | Whisper base + Omnilingual CTC-300M |
| `workstation-gpu` | NVIDIA 8+ GB | Whisper large-v3-turbo + Omnilingual LLM-1B |
| `server-gpu` | NVIDIA 16+ GB | Whisper large-v3 + Omnilingual LLM-3B |

## Guides

- [Languages and accuracy](languages.md): coverage, routing, measured results, choosing models
- [Browser extension](https://github.com/semajehq/semaje-extension/blob/main/docs/browser-extension.md): install, publish, enterprise rollout, daily use
- Repositories: [platform](https://github.com/semajehq/semaje) · [stt](https://github.com/semajehq/semaje-stt) · [tts](https://github.com/semajehq/semaje-tts) · [web](https://github.com/semajehq/semaje-web) · [extension](https://github.com/semajehq/semaje-extension) · [languages](https://github.com/semajehq/semaje-languages)
- [Quality evaluations](evaluations.md)
- [Low-cost operations](low-cost-operations.md)
- [Backup and restore](backup-restore.md)
