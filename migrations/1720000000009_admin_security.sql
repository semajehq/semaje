CREATE TABLE IF NOT EXISTS invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_org_created_idx
  ON audit_events (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_org_action_idx
  ON audit_events (org_id, action, created_at DESC);

CREATE TABLE IF NOT EXISTS retention_policies (
  org_id         uuid PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  enabled        boolean NOT NULL DEFAULT false,
  default_days   integer NOT NULL DEFAULT 365 CHECK (default_days BETWEEN 1 AND 36500),
  source_rules   jsonb NOT NULL DEFAULT '{}'::jsonb,
  delete_audio   boolean NOT NULL DEFAULT true,
  updated_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retention_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  dry_run        boolean NOT NULL DEFAULT true,
  transcripts    integer NOT NULL DEFAULT 0,
  audio_blobs    integer NOT NULL DEFAULT 0,
  status         text NOT NULL CHECK (status IN ('succeeded','failed')),
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
