-- Up Migration

CREATE TYPE monitor_status AS ENUM ('pending', 'up', 'suspected_down', 'down', 'suspected_up');

-- Counters live on monitors (not in scheduler memory) so a monitor sitting partway to a
-- transition keeps that progress across restarts -- Railway redeploys restart the process
-- routinely, and losing the count would silently reset outage detection (DECISIONS.md #19).
ALTER TABLE monitors
  ADD COLUMN status monitor_status NOT NULL DEFAULT 'pending',
  ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN consecutive_successes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN status_changed_at TIMESTAMPTZ;

-- Down Migration

ALTER TABLE monitors
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS consecutive_failures,
  DROP COLUMN IF EXISTS consecutive_successes,
  DROP COLUMN IF EXISTS status_changed_at;

DROP TYPE IF EXISTS monitor_status;
