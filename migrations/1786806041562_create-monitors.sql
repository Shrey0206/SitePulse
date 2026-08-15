-- Up Migration

CREATE TABLE monitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  interval_seconds INTEGER NOT NULL,
  timeout_seconds INTEGER NOT NULL,
  expected_status INTEGER NOT NULL DEFAULT 200,
  failure_threshold INTEGER NOT NULL DEFAULT 3,
  recovery_threshold INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT monitors_timeout_lte_interval CHECK (timeout_seconds <= interval_seconds)
);

CREATE INDEX monitors_organization_id_idx ON monitors(organization_id);

CREATE TRIGGER monitors_set_updated_at
  BEFORE UPDATE ON monitors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS monitors;
