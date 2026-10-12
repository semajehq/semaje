# Low-cost operations

## Read the signal room

Open **Platform → Telemetry** to inspect queue wait, processing p95, failure clusters, model realtime
factor, source storage, confidence, diarization coverage, and the latest WER fixture. A realtime factor
below `1.0x` means transcription is faster than the recording duration. Queue wait rising while
realtime factor stays flat usually means worker capacity, not model speed, is the constraint.

Prometheus can scrape `GET /metrics`. Without `METRICS_TOKEN`, the endpoint accepts private-network
clients only. For any routed deployment, set a long random token and configure Prometheus:

```yaml
scrape_configs:
  - job_name: semaje
    static_configs: [{ targets: ["api:3001"] }]
    bearer_token: "replace-with-METRICS_TOKEN"
```

Logs from the API and worker are newline-delimited JSON. Index `event`, `jobId`, `orgId`, `model`,
`runtimeSec`, and `realtimeFactor`; do not parse human sentences.

## Tune inexpensive hardware

1. Start with `base` on CPU and `WORKER_CONCURRENCY=1`. Increase concurrency only when memory remains
   stable and queue wait is the dominant delay.
2. Use `STT_COMPUTE_TYPE=int8` on CPU. Use GPU-specific compute types only after confirming the
   runtime selected the accelerator in the model workshop.
3. Prefer `tiny` or `base` for high-volume drafts; reserve larger models for noisy or multilingual
   recordings where the confidence and WER measurements justify the cost.
4. Keep `EMBEDDING_ENABLED=false` when semantic search is unnecessary. Meeting enrichment can use a
   small quantized local model such as `qwen2.5:3b`.
5. Configure source retention so temporary dictation audio expires before meeting records. Preview
   the policy before every destructive run.
6. Watch model cache and audio storage separately. Removing an inactive model does not delete
   transcripts, while deleting source audio affects playback.

## Quality fixture

Run `make eval` in semaje-stt on the host. The evaluator writes
`data/observability/stt-eval.json`; the signal room and Prometheus endpoint publish that result.
Keep the same fixture, language, model, and hardware when comparing changes. A missing report is
shown as `not run`, never interpreted as zero WER.

## Failure triage

- High queue wait, low realtime factor: add a worker slot if RAM allows.
- High realtime factor: select a smaller model or faster compute type.
- Repeated audio decode errors: inspect the ingest format and retained source blob.
- LLM failures after successful STT: inspect `processing_meta.llm`, then test the local AI adapter.
- Falling confidence or speaker coverage: rerun the fixed WER fixture and compare model/runtime changes.
