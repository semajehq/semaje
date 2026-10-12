# semaje — Setup Guide

Open-source speech platform: **Whisper + Omnilingual ASR** do speech-to-text in
1,600+ languages, **Piper / MMS-TTS** do text-to-speech, a **local open LLM**
(Ollama or llama.cpp) handles the 15 language tasks over the transcript, and
everything lands in a **persistent, searchable library** with sharing, exports,
async jobs for long recordings, and a realtime WebSocket for dictation. The
browser extension brings dictation, live captions, and read-aloud to any page.

## Architecture

```
                       ┌─ services/stt (Whisper + Omnilingual ASR, :8011, Python)
                       ├─ services/tts (Piper | MMS-TTS, :8012, Python)
web app / extension ─▶ services/api (:3001, HTTP + /ws)
                       ├─ services/realtime (WS windows → stt)
                       ├─ services/jobs (pg-boss queue + worker)
                       │    └─ storage → stt → pipeline → llm → transcripts
                       ├─ services/transcripts (Postgres FTS library, shares)
                       ├─ services/auth (single-user | local-db | oidc)
                       ├─ services/storage (fs | s3/MinIO)
                       └─ services/llm (ollama | llama-cpp | claude-local)
      packages/languages: shared registry (1,693 languages) used by stt, tts, api
```

Deployment mode is **adapter-driven** — the same codebase runs:

| Mode | AUTH_ADAPTER | STORAGE_ADAPTER | Stack |
|---|---|---|---|
| Single user (default) | `single-user` | `fs` | postgres + stt + tts + api/worker |
| Small team | `local-db` | `fs` or `s3` | + accounts/login |
| Cloud (Phase 3) | `oidc` | `s3` | + SSO, GPU pool |

## Quick start (Docker, recommended)

```bash
cp .env.example .env
deploy/semaje cpu up
open http://localhost:8080
```

The deploy command builds the web app in Docker, migrates Postgres, starts the
worker, and persists blobs, models, exports, and logs. No hosted API key is
needed.

### Hardware profiles

| Profile | Recommended hardware | Defaults | Command |
|---|---|---|---|
| `cpu` | 4 cores, 8 GB RAM, 15 GB disk | Whisper `base` int8 + Omnilingual CTC-300M, one worker | `deploy/semaje cpu up` |
| `workstation-gpu` | NVIDIA 8+ GB VRAM, 16 GB RAM | Whisper `large-v3-turbo` + Omnilingual LLM-1B, two jobs | `deploy/semaje workstation-gpu up` |
| `server-gpu` | NVIDIA 16+ GB VRAM, 32 GB RAM | Whisper `large-v3` + Omnilingual LLM-3B, two workers | `deploy/semaje server-gpu up` |

GPU profiles require the NVIDIA driver and NVIDIA Container Toolkit. Override
`STT_WHISPER_MODEL`, `STT_OMNILINGUAL_MODEL`, `WORKER_CONCURRENCY`, and
`WORKER_REPLICAS` in `.env` to fit your machine. The first start downloads the
speech models; `stt` reports healthy only once they are loaded, so no request
ever waits on a download. Set `STT_OMNILINGUAL_BUILD=0` for a Whisper-only image
(about 1.5 GB smaller) if you only need its 99 languages.

> **Apple Silicon / ARM hosts.** Omnilingual ASR's runtime has prebuilt Linux
> wheels for x86-64 only, so a Docker image built on an ARM machine is
> Whisper-only. On a Mac, run the speech services natively (`npm run setup`,
> `npm run dev:stt`) to get both engines, or build with
> `DOCKER_DEFAULT_PLATFORM=linux/amd64`. Production x86-64 servers get both
> engines in Docker with no extra steps. Use `deploy/semaje <profile> status|logs|down` for operations.

## Local development (no Docker for the app)

Prereqs: Node 22+, Python 3.11, ffmpeg, libsndfile (`brew install ffmpeg
libsndfile` / `apt install ffmpeg libsndfile1`), and Postgres with a `semaje`
database (`docker compose up -d postgres` works).

```bash
# 1. Speech services (one-time): venvs + models in ~/.local/share/semaje
#    (kept out of the repo: iCloud/OneDrive eviction breaks venvs)
npm run setup

# 2. App deps + DB schema
npm install
npm run migrate

# 3. Everything at once: stt (:8011) + tts (:8012) + api (:3001) + web (:5173)
npm run dev

# 4. The job worker (needed for >20MB async uploads), separate terminal:
npm run worker
```

## Browser extension

`npm run ext:build`, then follow [docs/browser-extension.md](docs/browser-extension.md)
for Chrome, Edge, Brave, Opera, Vivaldi, Arc, Firefox, Safari, store publishing,
and enterprise force-install.

## Languages, speech output, and licenses

See [docs/languages.md](docs/languages.md) for routing, measured accuracy, and
model choices. Text-to-speech uses Piper by default.
`TTS_ALLOW_NONCOMMERCIAL=true` adds MMS-TTS for about 1,100 more languages under
its CC-BY-NC-4.0 license (install with `SEMAJE_MMS=1 services/tts/setup.sh` or
build with `TTS_MMS_BUILD=1`). For production, set `STT_API_TOKEN` and
`TTS_API_TOKEN` so only the API and worker can reach the speech services.

## LLM adapter

`LLM_ADAPTER=ollama` (default) runs open-weight models through Ollama on your
own machine. `LLM_ADAPTER=llama-cpp` uses a llama.cpp server.
`LLM_ADAPTER=claude-local` shells out to a locally installed Claude Code CLI.
There is no hosted-API adapter.
The local deployment profile pulls `OLLAMA_MODEL` automatically. A llama.cpp
OpenAI-compatible server is also supported: place a GGUF file in the
`llamamodels` volume and run compose with `--profile llama-cpp`.

## Local search and embeddings

Postgres full-text search is always available offline and requires no model.
Optional semantic search uses the configured Ollama endpoint with
`EMBEDDING_MODEL=nomic-embed-text`. Set `EMBEDDING_ENABLED=true` to index new
transcripts automatically; existing transcripts can be indexed from the API.
Vectors remain in Postgres as arrays, so pgvector is not required.

## Watched-folder capture

The standard Compose stack includes a folder watcher. Drop supported audio or video files into
`./data/watch`; stable files are submitted through the same `/api/ingest` queue used by the web UI
and moved to `./data/watch/.semaje/completed` or `failed` when processing reaches a terminal state.

For `AUTH_ADAPTER=local-db`, create a transcribe-scoped key in Platform > API keys and set
`WATCH_API_KEY`. Outside Compose, run `npm run watch` and configure `WATCH_DIR` plus
`WATCH_API_BASE` as needed. Content hashes provide idempotency, so renamed duplicate recordings do
not create duplicate transcripts.

API clients can send a multipart `POST /api/ingest` with an `audio` file and optional `task`,
`options`, `source`, `webhookUrl`, and `Idempotency-Key`. Completion webhooks include an
`X-Semaje-Signature` HMAC header. Failed jobs can be requeued with `POST /api/jobs/:id/retry`.

For lightweight local microphone or system-audio capture, install ffmpeg and run
`npm run desktop -- --list-devices`, then `npm run desktop -- --input <device>`. The helper submits
the resulting mono WAV through the same ingest endpoint and does not require Electron.

## Exports, sharing, and routing

Transcript downloads include TXT, Markdown, JSON, SRT, VTT, and action-item CSV. Markdown and JSON
preserve source metadata, speakers, timestamps, summaries, decisions, risks, and action items.

Outbound integrations are disabled until configured. Set `INTEGRATION_FILE_SYNC_DIR` for local file
sync, Nextcloud WebDAV variables for a private cloud folder, Slack or Teams webhook URLs for channel
delivery, or `SMTP_URL` for email. The Routing board reports only enabled/disabled state and never
returns credential values to the browser.

Set `SHARING_ENABLED=false` to remove share-link creation and resolution for strict deployments.
`SHARE_LOCAL_ONLY=true` restricts shared links to loopback and RFC1918 clients. If semaje runs behind
a trusted reverse proxy, set `TRUST_PROXY_HOPS` to its hop count; the bundled Nginx/Compose profile
uses one hop.

Custom webhooks subscribe to job, transcript, and action-item events. Each body is signed in
`X-Semaje-Signature` with `WEBHOOK_SECRET`; see `services/integrations/contract.md` for verification
and retry behavior.

## Upgrades

1. Back up Postgres and the `blobdata` volume.
2. Pull the new source or image tag.
3. Run `deploy/semaje <profile> up`; the one-shot migration service finishes
   before API and workers are replaced.
4. Check `deploy/semaje <profile> status` and `/api/health`.

Database migrations are forward-only. Restore the backup before downgrading to
an older release.

## Tests & evals

```bash
npm test                    # gate tests: all TS services + extension (fast, free, no network)
npm run test:stt            # STT + language registry, incl. real ffmpeg format matrix
npm run test:tts            # TTS
npm run typecheck           # strict TS across services
npm run test:extension:e2e  # built extension in real Chrome + Firefox
npm run eval:fleurs         # real-speech WER/CER per language (FLEURS) vs thresholds
npm run eval:tts            # TTS → STT round-trip intelligibility
npm run eval:stt            # English smoke eval (macOS `say`)
npm run eval:llm            # 15 task rubrics × adapter(s)  [EVAL_ADAPTERS=ollama,claude-local]
npm run eval:realtime       # streaming WER vs batch
```

## Project structure

```
packages/schemas/       zod contracts shared by every service
packages/db/            pg pool factory
migrations/             Postgres schema (node-pg-migrate)
services/api/           HTTP gateway (auth, uploads, jobs, transcripts, rate limit)
services/auth/          identity adapters + JWT + API keys + tenancy guard
services/storage/       fs | s3 blob adapters
services/transcripts/   library: CRUD, FTS search, shares, SRT/VTT/TXT/MD exports
services/jobs/          pg-boss queue + transcription worker
services/ingest/        watched-folder intake through the shared ingest API
services/desktop/       optional ffmpeg microphone/system-audio capture helper
services/integrations/  default-off outbound adapters, signed events, delivery ledger
services/realtime/      WebSocket streaming STT (/ws)
services/llm/           ollama | llama-cpp | claude-local adapters + task evals
services/pipeline/      pure STT↔LLM routing
services/stt/           speech-to-text (Python: Whisper + Omnilingual ASR, any-format intake)
services/tts/           text-to-speech (Python: Piper, MMS-TTS, custom voices)
packages/languages/     shared language registry (1,693 languages)
services/extension/     cross-browser MV3 extension
src/                    React web app (transcribe, library, shares, settings)
```

## Troubleshooting

| Issue | Fix |
|---|---|
| `stt.reachable: false` in /api/health | Start it: `npm run dev:stt` (or the compose `stt` service; first start downloads models). |
| `tts.reachable: false` | `npm run dev:tts` (or compose `tts`). |
| Omnilingual import error (`_torch_library_impl`, `pyarrow requires NumPy 2`) | Install with `services/stt/setup.sh`; it pins `torchaudio==2.8.0` and `pyarrow<21`. |
| `fairseq2 requires libsndfile` | `brew install libsndfile` / `apt install libsndfile1`. |
| Jobs stay `queued` | The worker isn't running: `npm run worker` (or compose `worker`). |
| `claude-local failed to start` | Install the Claude Code CLI, or use `LLM_ADAPTER=ollama`. |
| 401s in local-db mode | Register at `/login`, or create an API key at `/settings/api-keys`. |
| Extension can't connect | Extension settings → Save & test; see [docs/browser-extension.md](docs/browser-extension.md#6-troubleshooting). |
| macOS: hangs / vanishing .venv | Project on iCloud Drive. `setup.sh` already keeps venvs/models in `~/.local/share/semaje`; keep `node_modules` downloaded or move the repo off iCloud. |
