# Transcript quality evaluations

## Fast smoke gate

Run `npm run eval:smoke`. It requires no network, audio codec, model, or GPU. The gate:

- computes WER and CER from committed CC0 generated-text fixtures;
- compares candidate quality and runtime with the committed smoke baseline;
- checks regression thresholds for WER, CER, and runtime ratio;
- builds the real prompts for summary, meeting actions/decisions, chapters, and sentiment;
- scores grounded task candidates against fixture evidence; and
- writes a schema-versioned report to `.eval-results/smoke-latest.json`.

CI runs this command after unit tests. Fixture candidates are deliberately deterministic: the smoke
path proves scoring, threshold, prompt-contract, and reporting behavior without pretending to test a
downloaded speech model.

## Compare a real STT backend

Start the local STT service (`npm run dev:stt`), then run:

```bash
npm run eval:stt:capture
npm run eval:smoke -- --candidate .eval-results/stt-candidate.json
```

On macOS, capture synthesizes the committed reference text with `say` and converts it with `ffmpeg`.
No third-party recording is redistributed. On other systems, set `EVAL_AUDIO_DIR` to a directory
containing licensed `meeting.wav`, `support.wav`, and `names.wav` files matching the manifest text.

Candidate files use this stable contract:

```json
{
  "backend": "faster-whisper",
  "model": "base",
  "runtimeMs": 1840,
  "hypotheses": { "meeting": "...", "support": "...", "names": "..." }
}
```

The report prints and records absolute WER/CER/runtime plus deltas from the baseline. Keep hardware,
compute type, fixture audio, language, and concurrency fixed when comparing model changes.

For a meaningful runtime or backend delta, preserve a real baseline and compare after the change:

```bash
EVAL_CANDIDATE_FILE=.eval-results/base-before.json npm run eval:stt:capture
# change backend, model, or compute profile
EVAL_CANDIDATE_FILE=.eval-results/base-after.json npm run eval:stt:capture
npm run eval:smoke -- --baseline .eval-results/base-before.json --candidate .eval-results/base-after.json
```

The harness deliberately marks fixture-to-real runtime and regression deltas as non-comparable;
absolute WER/CER thresholds still apply. This prevents synthetic CI values from masquerading as a
hardware or model regression.

## Full local profile

`npm run eval:full` captures a real STT candidate, applies the common comparison gate, runs the full
task adapter rubrics, and exercises realtime transcription. It is intentionally not a pull-request
gate because it requires a running model, local audio synthesis or licensed fixtures, and configured
LLM adapters.

Use `EVAL_ADAPTERS` to select task engines, `STT_URL` for the speech service, and
`EVAL_CANDIDATE_FILE` / `EVAL_REPORT_PATH` to retain named artifacts. The English smoke evaluator
also writes `data/observability/stt-eval.json`, which appears in the Signal Room.

## Baseline discipline

Only update `services/evals/baselines/smoke.json` and fixture candidates when a reviewed change
intentionally moves the quality bar. Include before/after report values in the pull request. Do not
raise thresholds merely to make a regression pass; document fixture limitations and add a targeted
case instead.

## Multilingual speech accuracy (FLEURS)

`npm run eval:fleurs` streams the first N test utterances per language straight
from Google's FLEURS dataset (CC-BY-4.0, no full download), sends them to the
running STT service as a black box, and scores WER and CER against FLEURS'
normalized references. It fails when:

- a language's CER exceeds `services/stt/evals/fleurs_thresholds.json`, or
- with `--engines auto,whisper`, automatic routing does worse than forced
  Whisper on any language (routing must never hurt).

```bash
npm run eval:fleurs -- --langs en_us,sw_ke,yo_ng,am_et,luo_ke,lg_ug --n 5 --engines auto,whisper
```

The report lands in `data/observability/stt-fleurs-eval.json`. Dated baselines
live beside the thresholds (`fleurs-baseline-2026-10-12.json`). When you upgrade
models, re-run, then tighten the thresholds.

## Text-to-speech intelligibility (round trip)

`npm run eval:tts` synthesizes a reference sentence per language with the TTS
service, recognizes it with the STT service, and scores CER: a voice the
recognizer cannot understand is a voice people will struggle with too.
Thresholds: `services/tts/evals/roundtrip_thresholds.json`. Languages without an
allowed voice are reported as skipped with the reason (for example
`license_noncommercial`), never as passes.
