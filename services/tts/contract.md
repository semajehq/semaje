# TTS Service — Contract (v1)

Open-source text-to-speech. Base URL `TTS_URL` (default `http://localhost:8012`).
Optional `TTS_API_TOKEN` bearer auth (all routes but `/health`, `/health/live`).

## Voices and licenses

| engine | coverage | license | default |
|---|---|---|---|
| `piper` | 177 voices, 58 locales | engine GPL-3.0-or-later (separate process); per-voice dataset license recorded | on |
| `custom` | any language you train | yours | on (drop files in `TTS_CUSTOM_VOICE_DIR`) |
| `mms` | ~1,100 languages (Meta MMS-TTS) | weights **CC-BY-NC-4.0** | off; `TTS_ALLOW_NONCOMMERCIAL=true` |

Selection (`catalog.choose_voice`, pure): explicit `voice`, else for the
language: custom → Piper → MMS (only if allowed); within an engine prefer the
requested region (`en-GB`), then installed voices, then quality. If only a
non-commercial voice exists and it is not allowed: **403
`license_noncommercial`** with the remedy. No voice at all: **404 `no_voice`**.

Custom voice: `<id>.onnx` + `<id>.onnx.json` (Piper format) + `<id>.semaje.json`
`{"language": "kik_Latn", "name": "Mumbi", "license": "CC-BY-4.0", "commercialUse": "yes"}`.

## `POST /synthesize` (JSON)

`{ "text": "...", "language": "sw", "voice": null, "format": "wav|mp3|ogg|webm|flac", "speed": 1.0, "speaker": null }`

Returns audio bytes. Headers: `x-semaje-voice`, `x-semaje-engine`,
`x-semaje-language` (canonical), `x-semaje-duration`, `x-semaje-license` (JSON),
`x-semaje-synthesis-ms`, `x-request-id`. Text is NFC-normalized, control
characters removed, split at sentence ends across scripts (Latin, Ethiopic,
Devanagari, Arabic, CJK) into ≤`TTS_CHUNK_CHARS` chunks. Max `TTS_MAX_CHARS`.

Errors `{error, code, requestId}`: 400 `invalid_text` · `invalid_format` ·
`unknown_language`; 401; 403 `license_noncommercial`; 404 `no_voice`; 422 (speed
out of 0.25–4); 503 `busy` / `voice_unavailable` (missing voice with
`TTS_AUTO_DOWNLOAD=false`).

## Other routes

`GET /voices?language=` · `POST /voices/download {voice}` · `GET /health` ·
`GET /health/live` · `GET /metrics`.
