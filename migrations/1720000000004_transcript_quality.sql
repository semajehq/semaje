ALTER TABLE transcripts
  ADD COLUMN IF NOT EXISTS speaker_labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS quality_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS transcript_revisions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id uuid NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  actor_id      uuid NOT NULL REFERENCES users(id),
  previous_text text NOT NULL,
  next_text     text NOT NULL,
  previous_segments jsonb,
  next_segments jsonb,
  reason        text NOT NULL DEFAULT 'manual correction',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transcript_revisions_transcript_idx
  ON transcript_revisions (transcript_id, created_at DESC);

CREATE TABLE IF NOT EXISTS glossary_terms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  term        text NOT NULL,
  replacement text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, term)
);
