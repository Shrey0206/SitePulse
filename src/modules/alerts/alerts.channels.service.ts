import { pool } from '../../db/pool.js';
import { AppError } from '../../shared/errors/AppError.js';
import type { CreateChannelInput, ListDeliveriesQuery, UpdateChannelInput } from './alerts.schemas.js';
import type { ChannelType } from './alerts.types.js';

interface ChannelRow {
  id: string;
  organization_id: string;
  type: ChannelType;
  target: string;
  enabled: boolean;
  created_at: Date;
}

export interface ChannelView {
  id: string;
  organizationId: string;
  type: ChannelType;
  target: string;
  enabled: boolean;
  createdAt: Date;
}

function toChannelView(row: ChannelRow): ChannelView {
  return {
    id: row.id,
    organizationId: row.organization_id,
    type: row.type,
    target: row.target,
    enabled: row.enabled,
    createdAt: row.created_at,
  };
}

// secret_encrypted is never in any SELECT here -- the API has no reason to return it, and
// leaving it out of the read path entirely is stronger than remembering to strip it.
const CHANNEL_COLUMNS = 'id, organization_id, type, target, enabled, created_at';

export async function createChannel(
  organizationId: string,
  input: CreateChannelInput,
  secretEncrypted: string | null = null,
): Promise<ChannelView> {
  const result = await pool.query<ChannelRow>(
    `INSERT INTO notification_channels (organization_id, type, target, enabled, secret_encrypted)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${CHANNEL_COLUMNS}`,
    [organizationId, input.type, input.target, input.enabled, secretEncrypted],
  );
  return toChannelView(result.rows[0]!);
}

export async function listChannels(organizationId: string): Promise<ChannelView[]> {
  const result = await pool.query<ChannelRow>(
    `SELECT ${CHANNEL_COLUMNS} FROM notification_channels WHERE organization_id = $1 ORDER BY created_at DESC`,
    [organizationId],
  );
  return result.rows.map(toChannelView);
}

export async function updateChannel(
  organizationId: string,
  channelId: string,
  input: UpdateChannelInput,
): Promise<ChannelView> {
  const result = await pool.query<ChannelRow>(
    `UPDATE notification_channels SET enabled = COALESCE($3, enabled)
     WHERE id = $1 AND organization_id = $2
     RETURNING ${CHANNEL_COLUMNS}`,
    [channelId, organizationId, input.enabled ?? null],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Notification channel not found');
  return toChannelView(row);
}

export async function deleteChannel(organizationId: string, channelId: string): Promise<void> {
  const result = await pool.query(
    `DELETE FROM notification_channels WHERE id = $1 AND organization_id = $2`,
    [channelId, organizationId],
  );
  if (result.rowCount === 0) throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Notification channel not found');
}

interface DeliveryRow {
  id: string;
  incident_id: string;
  channel: ChannelType;
  event: string;
  status: 'sent' | 'failed';
  target: string;
  response_code: number | null;
  latency_ms: number | null;
  error: string | null;
  created_at: Date;
}

export async function listDeliveries(organizationId: string, query: ListDeliveriesQuery) {
  const values: (string | number)[] = [organizationId];
  let where = 'organization_id = $1';

  if (query.incidentId) {
    values.push(query.incidentId);
    where += ` AND incident_id = $${values.length}`;
  }
  values.push(query.limit);

  const result = await pool.query<DeliveryRow>(
    `SELECT id, incident_id, channel, event, status, target, response_code, latency_ms, error, created_at
     FROM alert_deliveries WHERE ${where} ORDER BY created_at DESC LIMIT $${values.length}`,
    values,
  );

  return result.rows.map((row) => ({
    id: row.id,
    incidentId: row.incident_id,
    channel: row.channel,
    event: row.event,
    status: row.status,
    target: row.target,
    responseCode: row.response_code,
    latencyMs: row.latency_ms,
    error: row.error,
    createdAt: row.created_at,
  }));
}
