ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS processing_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE transcripts
  ADD COLUMN IF NOT EXISTS processing_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS jobs_processing_model_idx
  ON jobs ((processing_meta->>'model'));
