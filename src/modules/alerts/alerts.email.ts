import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import type { AlertContext, DeliveryOutcome } from './alerts.types.js';

// Provider-agnostic SMTP rather than a vendor SDK (DECISIONS.md #21) -- swapping Mailtrap
// for a production relay is a config change, not a code change.
const transporter = nodemailer.createTransport({
  host: env.smtpHost,
  port: env.smtpPort,
  secure: false,
  auth: env.smtpUser && env.smtpPassword ? { user: env.smtpUser, pass: env.smtpPassword } : undefined,
});

function buildEmail(context: AlertContext): { subject: string; text: string } {
  const opened = context.event === 'incident_opened';
  const subject = opened
    ? `[SitePulse] ${context.monitorName} is DOWN`
    : `[SitePulse] ${context.monitorName} has RECOVERED`;

  const text = [
    opened
      ? `${context.monitorName} is not responding as expected.`
      : `${context.monitorName} is responding normally again.`,
    '',
    `URL: ${context.monitorUrl}`,
    `Time: ${context.occurredAt.toISOString()}`,
    `Incident: ${context.incidentId}`,
  ].join('\n');

  return { subject, text };
}

export async function sendAlertEmail(to: string, context: AlertContext): Promise<DeliveryOutcome> {
  const { subject, text } = buildEmail(context);
  const start = performance.now();

  try {
    await transporter.sendMail({ from: env.smtpFrom, to, subject, text });
    return { status: 'sent', responseCode: null, latencyMs: Math.round(performance.now() - start), error: null };
  } catch (err) {
    // Never rethrown: a failed notification is logged and moved past, so one bad channel
    // can't stop the others or fail the check write that triggered the alert.
    return {
      status: 'failed',
      responseCode: null,
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
