CREATE TABLE IF NOT EXISTS collections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#0f8f83',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

ALTER TABLE transcripts
  ADD COLUMN IF NOT EXISTS collection_id uuid REFERENCES collections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS search_meta_tsv tsvector;

CREATE OR REPLACE FUNCTION semaje_transcript_search_meta() RETURNS trigger AS $$
BEGIN
  NEW.search_meta_tsv := to_tsvector('simple',
    coalesce(NEW.result::text, '') || ' ' ||
    coalesce(NEW.speaker_labels::text, '') || ' ' ||
    coalesce(array_to_string(NEW.tags, ' '), '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transcripts_search_meta_trigger ON transcripts;
CREATE TRIGGER transcripts_search_meta_trigger
  BEFORE INSERT OR UPDATE OF result, speaker_labels, tags ON transcripts
  FOR EACH ROW EXECUTE FUNCTION semaje_transcript_search_meta();

UPDATE transcripts SET search_meta_tsv = to_tsvector('simple',
  coalesce(result::text, '') || ' ' || coalesce(speaker_labels::text, '') || ' ' ||
  coalesce(array_to_string(tags, ' '), '')
);
CREATE INDEX IF NOT EXISTS transcripts_search_meta_idx ON transcripts USING GIN (search_meta_tsv);
CREATE INDEX IF NOT EXISTS transcripts_collection_idx ON transcripts (org_id, collection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transcripts_tags_idx ON transcripts USING GIN (tags);

CREATE TABLE IF NOT EXISTS saved_searches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  query       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transcript_embeddings (
  transcript_id uuid PRIMARY KEY REFERENCES transcripts(id) ON DELETE CASCADE,
  org_id        uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  model         text NOT NULL,
  embedding     double precision[] NOT NULL,
  content_hash  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transcript_embeddings_org_idx ON transcript_embeddings (org_id);
