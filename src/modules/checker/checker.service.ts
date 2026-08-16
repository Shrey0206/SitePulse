import { pool } from '../../db/pool.js';
import type { CheckResult } from './checker.http.js';
import { type MonitorStatus, nextState } from './checker.state-machine.js';

export interface DueMonitor {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  intervalSeconds: number;
  timeoutSeconds: number;
  expectedStatus: number;
  failureThreshold: number;
  recoveryThreshold: number;
}

interface DueMonitorRow {
  id: string;
  organization_id: string;
  name: string;
  url: string;
  interval_seconds: number;
  timeout_seconds: number;
  expected_status: number;
  failure_threshold: number;
  recovery_threshold: number;
}

export async function getDueMonitors(): Promise<DueMonitor[]> {
  const result = await pool.query<DueMonitorRow>(
    `SELECT id, organization_id, name, url, interval_seconds, timeout_seconds, expected_status,
            failure_threshold, recovery_threshold
     FROM monitors
     WHERE last_checked_at IS NULL OR last_checked_at <= now() - (interval_seconds * interval '1 second')`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    url: row.url,
    intervalSeconds: row.interval_seconds,
    timeoutSeconds: row.timeout_seconds,
    expectedStatus: row.expected_status,
    failureThreshold: row.failure_threshold,
    recoveryThreshold: row.recovery_threshold,
  }));
}

export interface RecordedCheck {
  previousStatus: MonitorStatus;
  status: MonitorStatus;
  statusChanged: boolean;
}

/**
 * Writes the check, advances the state machine, and persists the new counters as one
 * transaction (DECISIONS.md #19) -- a crash between the check insert and the counter
 * update would otherwise leave the state machine disagreeing with the check history it's
 * derived from.
 */
export async function recordCheckResult(monitorId: string, result: CheckResult): Promise<RecordedCheck> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Row lock held for the transaction. The scheduler already guarantees one in-flight
    // check per monitor (#20), so this is defence in depth rather than the primary
    // mechanism -- it also covers a second process (a future instance, or a test) writing
    // a check for the same monitor concurrently.
    const monitorResult = await client.query<{
      status: MonitorStatus;
      consecutive_failures: number;
      consecutive_successes: number;
      failure_threshold: number;
      recovery_threshold: number;
    }>(
      `SELECT status, consecutive_failures, consecutive_successes, failure_threshold, recovery_threshold
       FROM monitors WHERE id = $1 FOR UPDATE`,
      [monitorId],
    );
    const monitor = monitorResult.rows[0];
    if (!monitor) {
      // Deleted mid-check. Not an error worth failing the cycle over -- drop the result.
      await client.query('ROLLBACK');
      return { previousStatus: 'pending', status: 'pending', statusChanged: false };
    }

    await client.query(
      `INSERT INTO checks (monitor_id, success, status_code, response_time_ms, error) VALUES ($1, $2, $3, $4, $5)`,
      [monitorId, result.success, result.statusCode, result.responseTimeMs, result.error],
    );

    const previousStatus = monitor.status;
    const next = nextState(
      {
        status: previousStatus,
        consecutiveFailures: monitor.consecutive_failures,
        consecutiveSuccesses: monitor.consecutive_successes,
        failureThreshold: monitor.failure_threshold,
        recoveryThreshold: monitor.recovery_threshold,
      },
      result.success,
    );

    await client.query(
      `UPDATE monitors
       SET last_checked_at = now(),
           status = $2,
           consecutive_failures = $3,
           consecutive_successes = $4,
           status_changed_at = CASE WHEN $5 THEN now() ELSE status_changed_at END
       WHERE id = $1`,
      [monitorId, next.status, next.consecutiveFailures, next.consecutiveSuccesses, next.statusChanged],
    );

    await client.query('COMMIT');

    return { previousStatus, status: next.status, statusChanged: next.statusChanged };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
