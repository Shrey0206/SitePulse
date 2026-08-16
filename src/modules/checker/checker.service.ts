import { pool } from '../../db/pool.js';
import type { CheckResult } from './checker.http.js';

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

export async function recordCheckResult(monitorId: string, result: CheckResult): Promise<void> {
  await pool.query(
    `INSERT INTO checks (monitor_id, success, status_code, response_time_ms, error) VALUES ($1, $2, $3, $4, $5)`,
    [monitorId, result.success, result.statusCode, result.responseTimeMs, result.error],
  );
  await pool.query(`UPDATE monitors SET last_checked_at = now() WHERE id = $1`, [monitorId]);
}
