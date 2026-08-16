import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import type { CheckResult } from '../src/modules/checker/checker.http.js';
import { recordCheckResult } from '../src/modules/checker/checker.service.js';
import { dispatchAlerts } from '../src/modules/alerts/alerts.service.js';
import * as emailModule from '../src/modules/alerts/alerts.email.js';
import { closeDb, resetDb } from './helpers/db.js';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());
afterAll(closeDb);

async function signup(email: string, organizationName: string) {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email, password: 'password123', organizationName });
  return { token: res.body.data.accessToken as string, orgId: res.body.data.user.organizationId as string };
}

async function createMonitor(token: string): Promise<string> {
  const res = await request(app)
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
  return res.body.data.monitor.id as string;
}

async function addEmailChannel(token: string, target = 'oncall@example.com'): Promise<string> {
  const res = await request(app)
    .post('/api/v1/alerts/channels')
    .set('Authorization', `Bearer ${token}`)
    .send({ type: 'email', target });
  return res.body.data.channel.id as string;
}

const FAIL: CheckResult = { success: false, statusCode: 500, responseTimeMs: 5, error: null };

/** Stubs SMTP so tests assert on dispatch behaviour, not on a live mail server. */
function stubEmail(outcome: Partial<Awaited<ReturnType<typeof emailModule.sendAlertEmail>>> = {}) {
  return vi.spyOn(emailModule, 'sendAlertEmail').mockResolvedValue({
    status: 'sent',
    responseCode: null,
    latencyMs: 1,
    error: null,
    ...outcome,
  });
}

async function alertContextFor(orgId: string, monitorId: string, event: 'incident_opened' | 'incident_resolved') {
  const incident = await pool.query<{ id: string }>(
    `SELECT id FROM incidents WHERE monitor_id = $1 ORDER BY started_at DESC LIMIT 1`,
    [monitorId],
  );
  return {
    organizationId: orgId,
    incidentId: incident.rows[0]!.id,
    event,
    monitorName: 'Target',
    monitorUrl: 'https://example.com',
    occurredAt: new Date(),
  };
}

describe('alert dispatch', () => {
  it('sends to every enabled channel and logs each attempt', async () => {
    const send = stubEmail();
    const { token, orgId } = await signup('a1@example.com', 'AOrg1');
    await addEmailChannel(token, 'first@example.com');
    await addEmailChannel(token, 'second@example.com');
    const monitorId = await createMonitor(token);
    await recordCheckResult(monitorId, FAIL);
    await recordCheckResult(monitorId, FAIL);

    await dispatchAlerts(await alertContextFor(orgId, monitorId, 'incident_opened'));

    expect(send).toHaveBeenCalledTimes(2);
    const log = await pool.query(`SELECT status, channel FROM alert_deliveries`);
    expect(log.rowCount).toBe(2);
    expect(log.rows.every((r) => r.status === 'sent' && r.channel === 'email')).toBe(true);
  });

  it('skips disabled channels', async () => {
    const send = stubEmail();
    const { token, orgId } = await signup('a2@example.com', 'AOrg2');
    const channelId = await addEmailChannel(token);
    await request(app)
      .patch(`/api/v1/alerts/channels/${channelId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false })
      .expect(200);

    const monitorId = await createMonitor(token);
    await recordCheckResult(monitorId, FAIL);
    await recordCheckResult(monitorId, FAIL);
    await dispatchAlerts(await alertContextFor(orgId, monitorId, 'incident_opened'));

    expect(send).not.toHaveBeenCalled();
  });

  // DECISIONS.md #33: a failed send has to leave a record, or the delivery log is only
  // trustworthy for the successes -- which is the opposite of what it's for.
  it('logs a failed send with its error rather than throwing', async () => {
    stubEmail({ status: 'failed', error: 'SMTP connection refused' });
    const { token, orgId } = await signup('a3@example.com', 'AOrg3');
    await addEmailChannel(token);
    const monitorId = await createMonitor(token);
    await recordCheckResult(monitorId, FAIL);
    await recordCheckResult(monitorId, FAIL);

    await expect(dispatchAlerts(await alertContextFor(orgId, monitorId, 'incident_opened'))).resolves
      .toBeUndefined();

    const log = await pool.query<{ status: string; error: string }>(
      `SELECT status, error FROM alert_deliveries`,
    );
    expect(log.rows[0]).toMatchObject({ status: 'failed', error: 'SMTP connection refused' });
  });

  it('does not let one failing channel stop the others', async () => {
    const { token, orgId } = await signup('a4@example.com', 'AOrg4');
    await addEmailChannel(token, 'broken@example.com');
    await addEmailChannel(token, 'working@example.com');

    vi.spyOn(emailModule, 'sendAlertEmail').mockImplementation(async (to) =>
      to === 'broken@example.com'
        ? { status: 'failed', responseCode: null, latencyMs: 1, error: 'nope' }
        : { status: 'sent', responseCode: null, latencyMs: 1, error: null },
    );

    const monitorId = await createMonitor(token);
    await recordCheckResult(monitorId, FAIL);
    await recordCheckResult(monitorId, FAIL);
    await dispatchAlerts(await alertContextFor(orgId, monitorId, 'incident_opened'));

    const log = await pool.query<{ status: string; target: string }>(
      `SELECT status, target FROM alert_deliveries ORDER BY target`,
    );
    expect(log.rows).toEqual([
      { status: 'failed', target: 'broken@example.com' },
      { status: 'sent', target: 'working@example.com' },
    ]);
  });

  it('only alerts channels belonging to the incident\'s own organization', async () => {
    const send = stubEmail();
    const a = await signup('a5a@example.com', 'AOrg5A');
    const b = await signup('a5b@example.com', 'AOrg5B');
    await addEmailChannel(a.token, 'a@example.com');
    await addEmailChannel(b.token, 'b@example.com');

    const monitorId = await createMonitor(a.token);
    await recordCheckResult(monitorId, FAIL);
    await recordCheckResult(monitorId, FAIL);
    await dispatchAlerts(await alertContextFor(a.orgId, monitorId, 'incident_opened'));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBe('a@example.com');
  });
});

describe('notification channels API', () => {
  it('never exposes the stored secret column', async () => {
    const { token, orgId } = await signup('c1@example.com', 'COrg1');
    await addEmailChannel(token);
    // Simulate a webhook secret sitting in the same table.
    await pool.query(
      `INSERT INTO notification_channels (organization_id, type, target, secret_encrypted)
       VALUES ($1, 'webhook', 'https://example.com/hook', 'super-secret-ciphertext')`,
      [orgId],
    );

    const res = await request(app).get('/api/v1/alerts/channels').set('Authorization', `Bearer ${token}`);
    expect(JSON.stringify(res.body)).not.toContain('super-secret-ciphertext');
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('rejects an invalid email target', async () => {
    const { token } = await signup('c2@example.com', 'COrg2');
    await request(app)
      .post('/api/v1/alerts/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'email', target: 'not-an-email' })
      .expect(400);
  });

  it('does not leak channels across organizations', async () => {
    const a = await signup('c3a@example.com', 'COrg3A');
    const b = await signup('c3b@example.com', 'COrg3B');
    const channelId = await addEmailChannel(a.token);

    await request(app)
      .patch(`/api/v1/alerts/channels/${channelId}`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ enabled: false })
      .expect(404);
    await request(app)
      .delete(`/api/v1/alerts/channels/${channelId}`)
      .set('Authorization', `Bearer ${b.token}`)
      .expect(404);

    const list = await request(app).get('/api/v1/alerts/channels').set('Authorization', `Bearer ${b.token}`);
    expect(list.body.data.channels).toHaveLength(0);
  });

  it('exposes the delivery log filtered by incident', async () => {
    stubEmail();
    const { token, orgId } = await signup('c4@example.com', 'COrg4');
    await addEmailChannel(token);
    const monitorId = await createMonitor(token);
    await recordCheckResult(monitorId, FAIL);
    await recordCheckResult(monitorId, FAIL);
    const context = await alertContextFor(orgId, monitorId, 'incident_opened');
    await dispatchAlerts(context);

    const res = await request(app)
      .get(`/api/v1/alerts/deliveries?incidentId=${context.incidentId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.data.deliveries).toHaveLength(1);
    expect(res.body.data.deliveries[0]).toMatchObject({ channel: 'email', event: 'incident_opened' });
  });
});
