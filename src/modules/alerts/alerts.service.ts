import { pool } from '../../db/pool.js';
import { decryptSecret } from './alerts.crypto.js';
import { sendAlertEmail } from './alerts.email.js';
import type { AlertContext, DeliveryOutcome, NotificationChannel } from './alerts.types.js';
import { sendAlertWebhook } from './alerts.webhook.js';

interface ChannelRow {
  id: string;
  organization_id: string;
  type: 'email' | 'webhook';
  target: string;
  secret_encrypted: string | null;
  enabled: boolean;
}

export async function getEnabledChannels(organizationId: string): Promise<NotificationChannel[]> {
  const result = await pool.query<ChannelRow>(
    `SELECT id, organization_id, type, target, secret_encrypted, enabled
     FROM notification_channels
     WHERE organization_id = $1 AND enabled = true`,
    [organizationId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    type: row.type,
    target: row.target,
    enabled: row.enabled,
    secret: row.secret_encrypted ? decryptSecret(row.secret_encrypted) : null,
  }));
}

async function logDelivery(
  channel: NotificationChannel,
  context: AlertContext,
  outcome: DeliveryOutcome,
): Promise<void> {
  await pool.query(
    `INSERT INTO alert_deliveries
       (organization_id, incident_id, notification_channel_id, channel, event, status, target,
        response_code, latency_ms, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      context.organizationId,
      context.incidentId,
      channel.id,
      channel.type,
      context.event,
      outcome.status,
      channel.target,
      outcome.responseCode,
      outcome.latencyMs,
      outcome.error,
    ],
  );
}

async function deliverTo(channel: NotificationChannel, context: AlertContext): Promise<void> {
  const outcome =
    channel.type === 'email'
      ? await sendAlertEmail(channel.target, context)
      : await sendAlertWebhook(channel, context);

  try {
    await logDelivery(channel, context, outcome);
  } catch (err) {
    // The delivery log is observability, not the alert itself -- failing to write it must
    // not turn a successfully-sent alert into an error.
    console.error('Failed to log alert delivery:', err);
  }
}

/**
 * Fires alerts for one incident transition across every enabled channel.
 *
 * Scoped to incident open/resolve, never to raw check results (DECISIONS.md #8), so a
 * monitor that stays down alerts once rather than on every failing check. Manual
 * incidents deliberately don't route here at all (#36).
 *
 * Never rejects: a notification failure is logged to alert_deliveries and swallowed, so
 * it can't roll back the check write that triggered it or block sibling channels.
 */
export async function dispatchAlerts(context: AlertContext): Promise<void> {
  try {
    const channels = await getEnabledChannels(context.organizationId);
    await Promise.all(channels.map((channel) => deliverTo(channel, context)));
  } catch (err) {
    console.error('Alert dispatch failed:', err);
  }
}
