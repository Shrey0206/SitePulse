-- Up Migration

CREATE TYPE incident_source AS ENUM ('auto', 'manual');

CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Nullable: auto incidents always reference exactly one monitor, but a manual incident
  -- may be org-wide (a declared maintenance window with no single monitor behind it).
  monitor_id UUID REFERENCES monitors(id) ON DELETE CASCADE,
  source incident_source NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT incidents_auto_requires_monitor CHECK (source = 'manual' OR monitor_id IS NOT NULL)
);

-- Enforces "at most one open auto incident per monitor" in the database rather than in
-- application logic (DECISIONS.md #28). The invariant runs on every check write, so a
-- race between two writers is the difference between a duplicate incident and a caught
-- constraint violation.
CREATE UNIQUE INDEX incidents_one_open_auto_per_monitor_idx
  ON incidents (monitor_id)
  WHERE source = 'auto' AND resolved_at IS NULL;

CREATE INDEX incidents_organization_id_started_at_idx ON incidents (organization_id, started_at DESC);
CREATE INDEX incidents_monitor_id_idx ON incidents (monitor_id);

CREATE TRIGGER incidents_set_updated_at
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS incidents;
DROP TYPE IF EXISTS incident_source;
