CREATE TABLE IF NOT EXISTS webhooks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  url         text NOT NULL,
  secret_hash text NOT NULL,
  events      text[] NOT NULL DEFAULT '{job.succeeded,job.failed}',
  disabled_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE webhooks
  ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Webhook',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS integration_deliveries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  transcript_id uuid REFERENCES transcripts(id) ON DELETE SET NULL,
  event       text NOT NULL,
  adapter     text NOT NULL,
  destination text,
  status      text NOT NULL CHECK (status IN ('succeeded','failed')),
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_deliveries_org_created_idx
  ON integration_deliveries (org_id, created_at DESC);
