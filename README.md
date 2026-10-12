# semaje

**Open-source speech platform for every language.** Speech-to-text and
text-to-speech in **1,600+ languages**, including hundreds of low-resource
African, Asian, and Indigenous languages, running entirely on your own
infrastructure. Any audio or video in; searchable, shareable transcripts out.
Dictate, caption, and read aloud on any web page with the browser extension.

No hosted AI APIs. Every model is open source and runs on your hardware.

| | Open-source model | License | Coverage |
|---|---|---|---|
| Speech recognition | OpenAI **Whisper** (faster-whisper / whisper.cpp) | MIT | 99 languages, word timing, translation |
| Speech recognition | Meta **Omnilingual ASR** | Apache-2.0 | 1,672 languages |
| Text-to-speech | **Piper** | GPL-3.0 engine, per-voice data licenses | 177 voices, 58 locales |
| Text-to-speech (opt-in) | Meta **MMS-TTS** | CC-BY-NC-4.0 weights | ~1,100 languages |
| Language tasks | Qwen / Llama / Mistral via **Ollama** or **llama.cpp** | open weights | summaries, notes, translation |

## Why two recognition engines

Each language goes to the engine that is actually good at it. Measured on real
speech (Google FLEURS test set):

| Language | semaje (auto) | Whisper alone |
|---|---|---|
| English | 2.8% CER (Whisper) | 2.8% |
| Swahili | **4.9%** (Omnilingual) | 24.3% |
| Amharic | **11.6%** | 148% (hallucinates) |
| Yoruba | **26.1%** | 51.5% |
| Luo, Luganda | **6.9%, 4.9%** | not supported |

Details and how to reproduce: [docs/languages.md](docs/languages.md).

## Repositories

semaje is split into focused repos. This one is the **platform**: the API,
job queue, realtime streaming, transcript library, auth, local-LLM task
pipeline, deployment, and docs. Everything else talks to it over HTTP.

| Repo | What it is | Ships as |
|---|---|---|
| **[semaje](https://github.com/semajehq/semaje)** (this) | API, jobs, realtime, library, auth, LLM tasks, deploy, docs | `ghcr.io/semajehq/semaje` |
| [semaje-stt](https://github.com/semajehq/semaje-stt) | speech-to-text: Whisper + Omnilingual ASR, any audio format | `ghcr.io/semajehq/semaje-stt` |
| [semaje-tts](https://github.com/semajehq/semaje-tts) | text-to-speech: Piper, opt-in MMS-TTS, custom voices | `ghcr.io/semajehq/semaje-tts` |
| [semaje-web](https://github.com/semajehq/semaje-web) | React web app (capture, library, meetings, model workshop) | `ghcr.io/semajehq/semaje-web` |
| [semaje-extension](https://github.com/semajehq/semaje-extension) | browser extension for Chrome, Edge, Brave, Opera, Vivaldi, Arc, Firefox, Safari | release zips per browser |
| [semaje-languages](https://github.com/semajehq/semaje-languages) | shared registry: 1,693 languages, every alias → one code | pip package (tagged) |

Each repo owns its code, tests, evals, CI, and release; the platform pins the
versions it runs in `.env` (`SEMAJE_STT_VERSION`, `SEMAJE_TTS_VERSION`,
`SEMAJE_WEB_VERSION`).

## What it does

- **Any audio, any format**: MP3, M4A/AAC, Opus/WebM, Ogg, FLAC, ALAC, WAV
  (8 kHz telephony to 96 kHz/24-bit studio), AMR voice notes, WMA, 5.1 surround,
  and video files (MP4, MOV, MKV). Long recordings run as background jobs.
- **15 task types** on top of the transcript: subtitles (SRT/VTT), summaries,
  meeting notes, chapters, translation, speaker labels, interview, medical,
  legal, and more, all run by a local open model.
- **Library**: every transcript persisted, full-text and semantic search,
  revisions, glossary, exports, share links.
- **Realtime**: streaming transcription over WebSocket for live mic and dictation.
- **Browser extension**: dictate into any field, live-caption any tab,
  transcribe any page media, read text aloud, with enterprise force-install.
- **Enterprise-ready**: SSO/OIDC, API keys with scopes, org tenancy, audit
  log, retention policies, Prometheus metrics, request tracing across services,
  readiness probes, capacity limits with back-pressure, air-gapped operation.

## Quick start

```bash
git clone https://github.com/semajehq/semaje && cd semaje
cp .env.example .env
deploy/semaje cpu up              # or workstation-gpu / server-gpu
open http://localhost:8080
```

Compose pulls the released STT, TTS, and web images and builds the platform.
The first start downloads the speech models (about 1.5 GB on CPU) before
reporting ready. Then install the
[browser extension](https://github.com/semajehq/semaje-extension).

Working on several repos at once: `npm run workspace` clones the others next to
this one, and `docker compose -f docker-compose.yml -f compose.dev.yml up --build`
runs the stack from your local checkouts. Details: [SETUP.md](SETUP.md).

## Platform services

| Service | Role |
|---|---|
| `services/api` | HTTP gateway: auth, uploads, jobs, transcripts, languages, TTS proxy, task catalog |
| `services/speech` | clients for the semaje-stt and semaje-tts contracts |
| `services/realtime` | WebSocket streaming STT (`/ws`) |
| `services/jobs` | pg-boss queue + transcription worker |
| `services/transcripts` | Postgres library, search, shares, exports |
| `services/auth` | single-user / local-db / OIDC, JWT, API keys |
| `services/storage` | fs / S3 blob adapters |
| `services/llm` | local open-model adapters (Ollama, llama.cpp) + the 15-task prompt library |

## Tests and evals

```bash
npm test                    # platform gate tests (no network)
npm run eval:smoke          # deterministic quality smoke eval
npm run eval:llm            # task-quality rubrics for the local LLM
```

Speech accuracy (FLEURS), TTS intelligibility, and the extension's real-browser
tests live in their repos.

## Licenses

Every model and runtime semaje uses is open source and keeps its own license
(table above). MMS-TTS weights are non-commercial and stay disabled unless an
operator enables them. Each Piper voice records its dataset license in
[semaje-languages](https://github.com/semajehq/semaje-languages) (`tts-voices.json`).
