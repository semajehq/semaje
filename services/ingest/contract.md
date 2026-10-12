# Capture and ingest contract

Every asynchronous capture path submits media to `POST /api/ingest` and receives the same job row.
The worker persists successful output through `createTranscript`, so uploads, watched folders, API
clients, extension dictation, desktop capture, and meeting capture share one library model.

## Multipart ingest

- Required: `audio`
- Optional: `task`, `options` JSON, `language`, `title`, `source`, `webhookUrl`, `captureMeta` JSON
- Idempotency: `Idempotency-Key` header or `idempotencyKey` field
- Authentication: JWT, single-user mode, or an API key with `transcribe` scope

The response is `202 { job, audioBlob, duplicate: false }`. A repeated idempotency key returns the
existing job with `200 { job, duplicate: true }` and does not store another audio blob.

## Watched folder

`npm run watch` scans `WATCH_DIR` after files settle, hashes file content, and submits it with source
`folder`. Accepted files move to `.semaje/processing`, then to `.semaje/completed` or
`.semaje/failed`. Network failures leave source files in place for retry.

## Recovery

`GET /api/jobs` exposes recent status and progress. `POST /api/jobs/:id/retry` moves a failed job
back to `queued`. Terminal webhooks are HMAC signed in `X-Semaje-Signature` and retried with capped
exponential backoff.
