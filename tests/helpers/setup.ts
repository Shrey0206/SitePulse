import { ensureChecksPartitions } from '../../src/modules/checker/checker.partitions.js';

// Tests import `app` directly and never start the scheduler, so nothing else creates the
// monthly partitions the checks table needs. Without this, any test that writes a check
// fails with "no partition of relation checks found for row" -- the same failure the
// scheduler's startup maintenance prevents in a running process (DECISIONS.md #32).
await ensureChecksPartitions();
