import { pool } from '../../db/pool.js';
import { getLastCycleCompletedAt } from './checker.scheduler.js';

export type CheckerHealthStatus = 'ok' | 'starting' | 'warning';

export interface CheckerHealth {
  status: CheckerHealthStatus;
  lastCycleCompletedAt: string | null;
}

const STARTUP_GRACE_MS = 15000;
const STALENESS_MULTIPLIER = 2;

const processStartedAt = Date.now();

export async function getCheckerHealth(): Promise<CheckerHealth> {
  const lastCycleCompletedAt = getLastCycleCompletedAt();

  const result = await pool.query<{ max_interval: number | null }>(
    `SELECT MAX(interval_seconds) AS max_interval FROM monitors`,
  );
  const maxIntervalSeconds = result.rows[0]?.max_interval;

  // No monitors configured yet -- there's nothing for the checker to be stale against.
  if (maxIntervalSeconds == null) {
    return { status: 'ok', lastCycleCompletedAt: lastCycleCompletedAt?.toISOString() ?? null };
  }

  if (!lastCycleCompletedAt) {
    const status = Date.now() - processStartedAt < STARTUP_GRACE_MS ? 'starting' : 'warning';
    return { status, lastCycleCompletedAt: null };
  }

  const staleAfterMs = maxIntervalSeconds * STALENESS_MULTIPLIER * 1000;
  const isStale = Date.now() - lastCycleCompletedAt.getTime() > staleAfterMs;

  return {
    status: isStale ? 'warning' : 'ok',
    lastCycleCompletedAt: lastCycleCompletedAt.toISOString(),
  };
}
