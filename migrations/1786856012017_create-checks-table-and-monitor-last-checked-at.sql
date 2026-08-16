-- Up Migration

-- Pulled forward from what was planned as a later migration: the scheduler's partition
-- maintenance (see PROGRESS.md) needs this table to exist as its first action, so it has
-- to exist before the scheduler does.
ALTER TABLE monitors ADD COLUMN last_checked_at TIMESTAMPTZ;

-- Declarative RANGE partitioning requires the partition key in every unique constraint,
-- so the primary key has to be (id, checked_at) rather than just (id).
CREATE TABLE checks (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  success BOOLEAN NOT NULL,
  status_code INTEGER,
  response_time_ms INTEGER,
  error TEXT,
  PRIMARY KEY (id, checked_at)
) PARTITION BY RANGE (checked_at);

-- An index on a declaratively-partitioned parent is automatically created on every
-- partition, existing and future, so this alone gives every partition the same index.
CREATE INDEX checks_monitor_id_checked_at_idx ON checks (monitor_id, checked_at);

-- No partitions are created here -- inserting before one exists for the current month
-- will fail outright. The scheduler creates the current month + a lookahead buffer at
-- startup and once daily, which is deliberate: see DECISIONS.md #32.

-- Down Migration

DROP TABLE IF EXISTS checks;
ALTER TABLE monitors DROP COLUMN IF EXISTS last_checked_at;
