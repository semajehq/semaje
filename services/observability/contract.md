# Observability contract

- `GET /api/admin/observability` returns organization-scoped queue, failure, compute, storage, quality, model-cache, and recent-job data.
- `GET /metrics` emits Prometheus text. Set `METRICS_TOKEN` for bearer authentication; without a token it accepts local-network clients only.
- Runtime logs are one-line JSON with `ts`, `level`, `service`, and `event` fields.
- STT evaluations publish `data/observability/stt-eval.json` (and `stt-fleurs-eval.json`, `tts-roundtrip-eval.json`); absence is reported as unavailable, never as a zero score.
