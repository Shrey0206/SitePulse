import { pool } from '../../db/pool.js';
import { AppError } from '../../shared/errors/AppError.js';
import type { CreateIncidentInput, ListIncidentsQuery, UpdateIncidentInput } from './incidents.schemas.js';

interface IncidentRow {
  id: string;
  organization_id: string;
  monitor_id: string | null;
  source: 'auto' | 'manual';
  title: string;
  description: string | null;
  started_at: Date;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface Incident {
  id: string;
  organizationId: string;
  monitorId: string | null;
  source: 'auto' | 'manual';
  title: string;
  description: string | null;
  startedAt: Date;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    organizationId: row.organization_id,
    monitorId: row.monitor_id,
    source: row.source,
    title: row.title,
    description: row.description,
    startedAt: row.started_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createManualIncident(
  organizationId: string,
  input: CreateIncidentInput,
): Promise<Incident> {
  if (input.monitorId) {
    // Verified explicitly rather than leaning on the FK: the FK alone would happily link
    // an incident to another org's monitor, which is a tenant leak, not just a bad id.
    const monitor = await pool.query(`SELECT 1 FROM monitors WHERE id = $1 AND organization_id = $2`, [
      input.monitorId,
      organizationId,
    ]);
    if (monitor.rowCount === 0) throw new AppError(404, 'MONITOR_NOT_FOUND', 'Monitor not found');
  }

  const result = await pool.query<IncidentRow>(
    `INSERT INTO incidents (organization_id, monitor_id, source, title, description)
     VALUES ($1, $2, 'manual', $3, $4)
     RETURNING *`,
    [organizationId, input.monitorId ?? null, input.title, input.description ?? null],
  );
  return toIncident(result.rows[0]!);
}

export async function listIncidents(organizationId: string, query: ListIncidentsQuery): Promise<Incident[]> {
  const conditions = ['organization_id = $1'];
  const values: (string | null)[] = [organizationId];

  if (query.status === 'open') conditions.push('resolved_at IS NULL');
  if (query.status === 'resolved') conditions.push('resolved_at IS NOT NULL');
  if (query.monitorId) {
    values.push(query.monitorId);
    conditions.push(`monitor_id = $${values.length}`);
  }

  const result = await pool.query<IncidentRow>(
    `SELECT * FROM incidents WHERE ${conditions.join(' AND ')} ORDER BY started_at DESC`,
    values,
  );
  return result.rows.map(toIncident);
}

export async function getIncident(organizationId: string, incidentId: string): Promise<Incident> {
  const result = await pool.query<IncidentRow>(
    `SELECT * FROM incidents WHERE id = $1 AND organization_id = $2`,
    [incidentId, organizationId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'INCIDENT_NOT_FOUND', 'Incident not found');
  return toIncident(row);
}

export async function updateManualIncident(
  organizationId: string,
  incidentId: string,
  input: UpdateIncidentInput,
): Promise<Incident> {
  const setClauses: string[] = [];
  const values: (string | null)[] = [];

  if (input.title !== undefined) {
    values.push(input.title);
    setClauses.push(`title = $${values.length}`);
  }
  if (input.description !== undefined) {
    values.push(input.description);
    setClauses.push(`description = $${values.length}`);
  }
  values.push(incidentId, organizationId);

  // Auto incidents are owned by the invariant, not the user -- editing their title or
  // description by hand would be overwritten on the next check write anyway.
  const result = await pool.query<IncidentRow>(
    `UPDATE incidents SET ${setClauses.join(', ')}
     WHERE id = $${values.length - 1} AND organization_id = $${values.length} AND source = 'manual'
     RETURNING *`,
    values,
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'INCIDENT_NOT_FOUND', 'Manual incident not found');
  return toIncident(row);
}

export async function resolveIncident(organizationId: string, incidentId: string): Promise<Incident> {
  // Auto incidents are resolvable by hand on purpose (an operator declaring an outage
  // over). If the monitor is still down the invariant reopens a fresh one on the next
  // check write -- that self-correction is exactly why #28 models this as an invariant
  // rather than a one-time edge.
  const result = await pool.query<IncidentRow>(
    `UPDATE incidents SET resolved_at = now()
     WHERE id = $1 AND organization_id = $2 AND resolved_at IS NULL
     RETURNING *`,
    [incidentId, organizationId],
  );
  const row = result.rows[0];
  if (!row) {
    const exists = await pool.query(`SELECT resolved_at FROM incidents WHERE id = $1 AND organization_id = $2`, [
      incidentId,
      organizationId,
    ]);
    if (exists.rowCount === 0) throw new AppError(404, 'INCIDENT_NOT_FOUND', 'Incident not found');
    throw new AppError(409, 'INCIDENT_ALREADY_RESOLVED', 'Incident is already resolved');
  }
  return toIncident(row);
}

export async function deleteManualIncident(organizationId: string, incidentId: string): Promise<void> {
  const result = await pool.query(
    `DELETE FROM incidents WHERE id = $1 AND organization_id = $2 AND source = 'manual'`,
    [incidentId, organizationId],
  );
  if (result.rowCount === 0) throw new AppError(404, 'INCIDENT_NOT_FOUND', 'Manual incident not found');
}
