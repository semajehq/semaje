ALTER TABLE transcripts DROP CONSTRAINT IF EXISTS transcripts_source_check;
ALTER TABLE transcripts
  ADD CONSTRAINT transcripts_source_check
  CHECK (source IN ('upload','live','meeting','dictation','folder','api','desktop','extension'));

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS ingest_key text,
  ADD COLUMN IF NOT EXISTS capture_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS jobs_org_ingest_key_idx
  ON jobs (org_id, ingest_key)
  WHERE ingest_key IS NOT NULL;
