# Jobs Service — Contract

Async transcription on pg-boss (Postgres-backed queue; no Redis for self-host).

## Lifecycle

`queued → running → succeeded | failed | canceled`; `failed → queued` (manual
retry). `succeeded`/`canceled` are terminal. Enforced by `assertTransition`.

## API

```ts
enqueueTranscribeJob(principal, JobInput, webhookUrl?, metadata?) -> job row // + queue send
getJob(principal, id) -> job | null                                 // org-scoped
listJobs(principal, limit?) -> job[]                                // org-scoped
retryJob(principal, id) -> job | null                               // failed -> queued
markJob(id, from, to, patch) -> row | null   // compare-and-set on status
processJob(jobId)   // worker: storage → whisper → pipeline → llm? → transcripts
startWorker()       // consumes QUEUE_TRANSCRIBE (npm run worker)
```

## Webhook (fires on terminal states when `webhook_url` set)

```json
{ "event": "job.succeeded", "jobId": "…", "status": "succeeded",
  "transcriptId": "…", "error": null, "ts": "ISO-8601" }
```

The body is signed with `WEBHOOK_SECRET` in `X-Semaje-Signature`. Delivery retries four times with
capped exponential backoff. Progress: 0 -> 20 (blob) -> 70 (whisper) -> 90 (llm) -> 100.
