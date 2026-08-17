import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import * as emailModule from '../src/modules/alerts/alerts.email.js';
import { dispatchAlerts } from '../src/modules/alerts/alerts.service.js';
import type { CheckResult } from '../src/modules/checker/checker.http.js';
import { recordCheckResult } from '../src/modules/checker/checker.service.js';
import { closeDb, resetDb } from './helpers/db.js';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());
afterAll(closeDb);

const FAIL: CheckResult = { success: false, statusCode: 500, responseTimeMs: 5, error: null };

async function signup(email: string, organizationName: string) {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email, password: 'password123', organizationName });
  return { token: res.body.data.accessToken as string, orgId: res.body.data.user.organizationId as string };
}

async function openIncident(token: string): Promise<string> {
  const created = await request(app)
    .post('/api/v1/monitors')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Target',
      url: 'https://example.com',
      intervalSeconds: 60,
      timeoutSeconds: 10,
      failureThreshold: 2,
      recoveryThreshold: 2,
    });
  const monitorId = created.body.data.monitor.id as string;
  await recordCheckResult(monitorId, FAIL);
  await recordCheckResult(monitorId, FAIL);

  const incident = await pool.query<{ id: string }>(`SELECT id FROM incidents WHERE monitor_id = $1`, [
    monitorId,
  ]);
  return incident.rows[0]!.id;
}

describe('alert dispatch resilience', () => {
  /**
   * A webhook secret that cannot be decrypted must not take the rest of alerting with it.
   *
   * This is reachable in production without anything exotic: rotating WEBHOOK_SECRET_KEY
   * invalidates every stored secret at once, and a partially-written or truncated row does
   * the same for one. Before the fix, decryption happened inside a .map() over all
   * channels, so a single bad row threw for the whole batch -- and since dispatchAlerts
   * swallows its own errors by design, the organization silently stopped receiving *any*
   * alerts, email included.
   */
  it('still delivers email when a webhook secret cannot be decrypted', async () => {
    const send = vi.spyOn(emailModule, 'sendAlertEmail').mockResolvedValue({
      status: 'sent',
      responseCode: null,
      latencyMs: 1,
      error: null,
    });

    const { token, orgId } = await signup('r1@example.com', 'ROrg1');
    await request(app)
      .post('/api/v1/alerts/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'email', target: 'oncall@example.com' });

    // A webhook row whose ciphertext is unusable, as a key rotation would leave it.
    await pool.query(
      `INSERT INTO notification_channels (organization_id, type, target, secret_encrypted)
       VALUES ($1, 'webhook', 'https://example.com/hook', 'not-decryptable')`,
      [orgId],
    );

    const incidentId = await openIncident(token);
    await dispatchAlerts({
      organizationId: orgId,
      incidentId,
      event: 'incident_opened',
      monitorName: 'Target',
      monitorUrl: 'https://example.com',
      occurredAt: new Date(),
    });

    expect(send).toHaveBeenCalledTimes(1);

    // The broken channel is logged as a failure rather than disappearing silently, so the
    // delivery log still answers "did the alert send, and if not why".
    const log = await pool.query<{ channel: string; status: string; error: string | null }>(
      `SELECT channel, status, error FROM alert_deliveries ORDER BY channel`,
    );
    expect(log.rows).toHaveLength(2);
    expect(log.rows[0]).toMatchObject({ channel: 'email', status: 'sent' });
    expect(log.rows[1]!.channel).toBe('webhook');
    expect(log.rows[1]!.status).toBe('failed');
    expect(log.rows[1]!.error).toBeTruthy();
  });

  it('delivers to remaining channels when one has an unusable secret', async () => {
    const send = vi.spyOn(emailModule, 'sendAlertEmail').mockResolvedValue({
      status: 'sent',
      responseCode: null,
      latencyMs: 1,
      error: null,
    });

    const { token, orgId } = await signup('r2@example.com', 'ROrg2');
    for (const target of ['a@example.com', 'b@example.com']) {
      await request(app)
        .post('/api/v1/alerts/channels')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'email', target });
    }
    await pool.query(
      `INSERT INTO notification_channels (organization_id, type, target, secret_encrypted)
       VALUES ($1, 'webhook', 'https://example.com/hook', 'garbage:garbage:garbage')`,
      [orgId],
    );

    const incidentId = await openIncident(token);
    await dispatchAlerts({
      organizationId: orgId,
      incidentId,
      event: 'incident_opened',
      monitorName: 'Target',
      monitorUrl: 'https://example.com',
      occurredAt: new Date(),
    });

    expect(send).toHaveBeenCalledTimes(2);
  });
});
