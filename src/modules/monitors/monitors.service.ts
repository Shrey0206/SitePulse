import { pool } from '../../db/pool.js';
import { AppError } from '../../shared/errors/AppError.js';
import { isCheckViolation } from '../../shared/utils/db-errors.js';
import type { MonitorStatus } from '../checker/checker.state-machine.js';
import type { CreateMonitorInput, UpdateMonitorInput } from './monitors.schemas.js';

interface MonitorRow {
  id: string;
  organization_id: string;
  name: string;
  url: string;
  interval_seconds: number;
  timeout_seconds: number;
  expected_status: number;
  failure_threshold: number;
  recovery_threshold: number;
  status: MonitorStatus;
  last_checked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface Monitor {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  intervalSeconds: number;
  timeoutSeconds: number;
  expectedStatus: number;
  failureThreshold: number;
  recoveryThreshold: number;
  /** Current state-machine status; the dashboard renders this until SSE supersedes it. */
  status: MonitorStatus;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toMonitor(row: MonitorRow): Monitor {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    url: row.url,
    intervalSeconds: row.interval_seconds,
    timeoutSeconds: row.timeout_seconds,
    expectedStatus: row.expected_status,
    failureThreshold: row.failure_threshold,
    recoveryThreshold: row.recovery_threshold,
    status: row.status,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createMonitor(organizationId: string, input: CreateMonitorInput): Promise<Monitor> {
  const result = await pool.query<MonitorRow>(
    `INSERT INTO monitors
       (organization_id, name, url, interval_seconds, timeout_seconds, expected_status,
        failure_threshold, recovery_threshold)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      organizationId,
      input.name,
      input.url,
      input.intervalSeconds,
      input.timeoutSeconds,
      input.expectedStatus,
      input.failureThreshold,
      input.recoveryThreshold,
    ],
  );
  return toMonitor(result.rows[0]!);
}

export async function listMonitors(organizationId: string): Promise<Monitor[]> {
  const result = await pool.query<MonitorRow>(`SELECT * FROM monitors WHERE organization_id = $1 ORDER BY created_at DESC`, [
    organizationId,
  ]);
  return result.rows.map(toMonitor);
}

export async function getMonitor(organizationId: string, monitorId: string): Promise<Monitor> {
  // Scoping by organization_id in the same WHERE (not a separate ownership check after
  // fetching by id) means a monitor in another org 404s exactly like a nonexistent one --
  // it never confirms whether the id exists at all.
  const result = await pool.query<MonitorRow>(`SELECT * FROM monitors WHERE id = $1 AND organization_id = $2`, [
    monitorId,
    organizationId,
  ]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'MONITOR_NOT_FOUND', 'Monitor not found');
  return toMonitor(row);
}

const UPDATABLE_COLUMNS: Record<keyof UpdateMonitorInput, string> = {
  name: 'name',
  url: 'url',
  intervalSeconds: 'interval_seconds',
  timeoutSeconds: 'timeout_seconds',
  expectedStatus: 'expected_status',
  failureThreshold: 'failure_threshold',
  recoveryThreshold: 'recovery_threshold',
};

export async function updateMonitor(
  organizationId: string,
  monitorId: string,
  input: UpdateMonitorInput,
): Promise<Monitor> {
  const entries = Object.entries(input) as [keyof UpdateMonitorInput, string | number][];

  const setClauses: string[] = [];
  const values: (string | number)[] = [];
  for (const [key, value] of entries) {
    values.push(value);
    setClauses.push(`${UPDATABLE_COLUMNS[key]} = $${values.length}`);
  }
  values.push(monitorId, organizationId);

  try {
    const result = await pool.query<MonitorRow>(
      `UPDATE monitors SET ${setClauses.join(', ')}
       WHERE id = $${values.length - 1} AND organization_id = $${values.length}
       RETURNING *`,
      values,
    );
    const row = result.rows[0];
    if (!row) throw new AppError(404, 'MONITOR_NOT_FOUND', 'Monitor not found');
    return toMonitor(row);
  } catch (err) {
    // Zod can only validate fields present in a partial update -- if only timeoutSeconds
    // is sent and it now exceeds the monitor's existing intervalSeconds, the DB's own
    // CHECK constraint is what actually catches it. Surface that as a normal 400 instead
    // of letting it fall through to a generic 500.
    if (isCheckViolation(err, 'monitors_timeout_lte_interval')) {
      throw new AppError(400, 'VALIDATION_ERROR', 'timeoutSeconds must be <= intervalSeconds');
    }
    throw err;
  }
}

export async function deleteMonitor(organizationId: string, monitorId: string): Promise<void> {
  const result = await pool.query(`DELETE FROM monitors WHERE id = $1 AND organization_id = $2`, [
    monitorId,
    organizationId,
  ]);
  if (result.rowCount === 0) throw new AppError(404, 'MONITOR_NOT_FOUND', 'Monitor not found');
}
