# Evaluation contract

- Smoke fixtures are committed, deterministic, and require no model or network download.
- STT candidates use `{ backend, model, runtimeMs, hypotheses: { fixtureId: text } }`.
- Reports include WER, CER, runtime, baseline deltas, task fixture results, thresholds, and a schema version.
- Fixture-to-real runtime is marked non-comparable; pass `--baseline` and `--candidate` real captures for hardware/model deltas.
- Full backend runs synthesize fixture speech locally; no third-party recording is redistributed.
- Linux/Windows runs may provide licensed `<fixture-id>.wav` files through `EVAL_AUDIO_DIR`.
- A failing threshold exits non-zero in local and CI modes.
