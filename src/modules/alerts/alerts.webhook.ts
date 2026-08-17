import { createHmac } from 'node:crypto';
import type { AlertContext, DeliveryOutcome, NotificationChannel } from './alerts.types.js';

const TIMEOUT_MS = 5000;
export const SIGNATURE_HEADER = 'X-SitePulse-Signature';
export const TIMESTAMP_HEADER = 'X-SitePulse-Timestamp';

export interface WebhookPayload {
  event: AlertContext['event'];
  incidentId: string;
  monitor: { name: string; url: string };
  occurredAt: string;
}

export function buildPayload(context: AlertContext): WebhookPayload {
  return {
    event: context.event,
    incidentId: context.incidentId,
    monitor: { name: context.monitorName, url: context.monitorUrl },
    occurredAt: context.occurredAt.toISOString(),
  };
}

/**
 * Signs `timestamp.body` rather than the body alone, so a receiver can reject a replayed
 * request by checking the timestamp's age -- signing only the body would make a captured
 * request valid forever.
 */
export function signPayload(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** Takes the already-decrypted secret; the caller owns decryption so it can isolate its failures. */
export async function sendAlertWebhook(
  channel: NotificationChannel & { secret: string },
  context: AlertContext,
): Promise<DeliveryOutcome> {
  const body = JSON.stringify(buildPayload(context));
  const timestamp = Math.floor(context.occurredAt.getTime() / 1000).toString();
  const signature = signPayload(channel.secret, timestamp, body);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = performance.now();

  try {
    const response = await fetch(channel.target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [SIGNATURE_HEADER]: signature,
        [TIMESTAMP_HEADER]: timestamp,
      },
      body,
      signal: controller.signal,
    });

    const latencyMs = Math.round(performance.now() - start);
    // Single attempt, no retry (DECISIONS.md #23): retrying reliably would require
    // surviving process restarts, which means a queue -- and #4 deliberately has none.
    // A 5xx is recorded as failed and left at that, rather than pretending to retry.
    return {
      status: response.ok ? 'sent' : 'failed',
      responseCode: response.status,
      latencyMs,
      error: response.ok ? null : `Received HTTP ${response.status}`,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      status: 'failed',
      responseCode: null,
      latencyMs,
      error: isAbort ? 'Request timed out' : err instanceof Error ? err.message : 'Unknown error',
    };
  } finally {
    clearTimeout(timeout);
  }
}
