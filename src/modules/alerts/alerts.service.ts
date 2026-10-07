import { pool } from '../../db/pool.js';
import { CHAT_SERVICE_LABEL, isChatChannelType, sendAlertChat } from './alerts.chat.js';
import { decryptSecret } from './alerts.crypto.js';
import { sendAlertEmail } from './alerts.email.js';
import type { AlertContext, ChannelType, DeliveryOutcome, NotificationChannel } from './alerts.types.js';
import { sendAlertWebhook } from './alerts.webhook.js';

interface ChannelRow {
  id: string;
  organization_id: string;
  type: ChannelType;
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

  // Deliberately does not decrypt here. Decryption can fail -- a rotated
  // WEBHOOK_SECRET_KEY invalidates every stored secret at once, and a truncated row does
  // the same for one -- and doing it inside this map made a single bad row throw for the
  // whole batch. Since dispatchAlerts swallows its own errors by design, that silently
  // stopped every alert for the organization, email included.
  return result.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    type: row.type,
    target: row.target,
    enabled: row.enabled,
    secretEncrypted: row.secret_encrypted,
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

/**
 * Resolves one channel's outcome, containing every failure mode to that channel alone.
 *
 * Anything thrown here becomes a logged `failed` delivery rather than propagating, so a
 * single broken channel can neither abort the batch nor vanish from the delivery log --
 * "did the alert send, and if not why" has to stay answerable precisely when something is
 * wrong (DECISIONS.md #33).
 */
async function attemptDelivery(
  channel: NotificationChannel,
  context: AlertContext,
): Promise<DeliveryOutcome> {
  try {
    if (channel.type === 'email') {
      return await sendAlertEmail(channel.target, context);
    }

    if (!channel.secretEncrypted) {
      return {
        status: 'failed',
        responseCode: null,
        latencyMs: 0,
        error: isChatChannelType(channel.type)
          ? `${CHAT_SERVICE_LABEL[channel.type]} channel has no stored webhook URL`
          : 'Webhook has no signing secret',
      };
    }

    // Decrypted per-channel: a key rotation or a corrupted row fails this channel only,
    // leaving every other channel to deliver normally.
    const secret = decryptSecret(channel.secretEncrypted);

    if (isChatChannelType(channel.type)) {
      // For chat channels the decrypted value is the webhook URL itself, not a signing key.
      return await sendAlertChat(channel.type, secret, context);
    }
    return await sendAlertWebhook({ ...channel, secret }, context);
  } catch (err) {
    return {
      status: 'failed',
      responseCode: null,
      latencyMs: 0,
      error: err instanceof Error ? err.message : 'Unknown delivery error',
    };
  }
}

async function deliverTo(channel: NotificationChannel, context: AlertContext): Promise<void> {
  const outcome = await attemptDelivery(channel, context);

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
