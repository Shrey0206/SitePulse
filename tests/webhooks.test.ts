import { createHmac, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { decryptSecret, encryptSecret, generateWebhookSecret } from '../src/modules/alerts/alerts.crypto.js';
import { dispatchAlerts } from '../src/modules/alerts/alerts.service.js';
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  signPayload,
} from '../src/modules/alerts/alerts.webhook.js';
import type { CheckResult } from '../src/modules/checker/checker.http.js';
import { recordCheckResult } from '../src/modules/checker/checker.service.js';
import { closeDb, resetDb } from './helpers/db.js';

beforeEach(resetDb);
afterAll(closeDb);

interface ReceivedRequest {
  body: string;
  signature: string | undefined;
  timestamp: string | undefined;
}

interface Receiver {
  url: string;
  received: ReceivedRequest[];
  close: () => Promise<void>;
}

/** A real HTTP receiver, so signature verification is exercised over the wire. */
async function startReceiver(handler?: (res: http.ServerResponse) => void): Promise<Receiver> {
  const received: ReceivedRequest[] = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({
        body,
        signature: req.headers[SIGNATURE_HEADER.toLowerCase()] as string | undefined,
        timestamp: req.headers[TIMESTAMP_HEADER.toLowerCase()] as string | undefined,
      });
      if (handler) return handler(res);
      res.writeHead(200);
      res.end('ok');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/hook`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const openReceivers: Receiver[] = [];
afterEach(async () => {
  await Promise.all(openReceivers.splice(0).map((r) => r.close()));
});

async function receiver(handler?: (res: http.ServerResponse) => void): Promise<Receiver> {
  const r = await startReceiver(handler);
  openReceivers.push(r);
  return r;
}

async function signup(email: string, organizationName: string) {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email, password: 'password123', organizationName });
  return { token: res.body.data.accessToken as string, orgId: res.body.data.user.organizationId as string };
}

const FAIL: CheckResult = { success: false, statusCode: 500, responseTimeMs: 5, error: null };

async function createDownMonitorWithIncident(token: string): Promise<{ monitorId: string; incidentId: string }> {
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
  const monitorId = res.body.data.monitor.id as string;
  await recordCheckResult(monitorId, FAIL);
  await recordCheckResult(monitorId, FAIL);

  const incident = await pool.query<{ id: string }>(`SELECT id FROM incidents WHERE monitor_id = $1`, [
    monitorId,
  ]);
  return { monitorId, incidentId: incident.rows[0]!.id };
}

function contextFor(orgId: string, incidentId: string) {
  return {
    organizationId: orgId,
    incidentId,
    event: 'incident_opened' as const,
    monitorName: 'Target',
    monitorUrl: 'https://example.com',
    occurredAt: new Date(),
  };
}

describe('webhook secret encryption', () => {
  it('round-trips a secret through encrypt/decrypt', () => {
    const secret = generateWebhookSecret();
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('produces different ciphertext each time, so identical secrets are not correlatable', () => {
    const secret = 'whsec_same_value';
    expect(encryptSecret(secret)).not.toBe(encryptSecret(secret));
  });

  it('rejects ciphertext that has been tampered with', () => {
    const stored = encryptSecret('whsec_original');
    const [iv, tag, ciphertext] = stored.split(':') as [string, string, string];
    const flipped = ciphertext.startsWith('a') ? `b${ciphertext.slice(1)}` : `a${ciphertext.slice(1)}`;
    // GCM's auth tag is what makes this detectable rather than silently decrypting to junk.
    expect(() => decryptSecret([iv, tag, flipped].join(':'))).toThrow();
  });

  it('rejects a malformed stored value', () => {
    expect(() => decryptSecret('not-valid')).toThrow(/malformed/i);
  });
});

describe('webhook delivery', () => {
  it('delivers a signed payload a receiver can verify', async () => {
    const target = await receiver();
    const { token, orgId } = await signup('w1@example.com', 'WOrg1');

    const created = await request(app)
      .post('/api/v1/alerts/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'webhook', target: target.url })
      .expect(201);

    const secret = created.body.data.secret as string;
    expect(secret).toMatch(/^whsec_/);

    const { incidentId } = await createDownMonitorWithIncident(token);
    await dispatchAlerts(contextFor(orgId, incidentId));

    expect(target.received).toHaveLength(1);
    const call = target.received[0]!;

    // Verify exactly the way a real receiver would.
    const expected = signPayload(secret, call.timestamp!, call.body);
    expect(
      timingSafeEqual(Buffer.from(call.signature!, 'hex'), Buffer.from(expected, 'hex')),
    ).toBe(true);

    expect(JSON.parse(call.body)).toMatchObject({
      event: 'incident_opened',
      incidentId,
      monitor: { name: 'Target', url: 'https://example.com' },
    });
  });

  it('produces a signature that fails verification under the wrong secret', async () => {
    const target = await receiver();
    const { token, orgId } = await signup('w2@example.com', 'WOrg2');
    await request(app)
      .post('/api/v1/alerts/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'webhook', target: target.url });

    const { incidentId } = await createDownMonitorWithIncident(token);
    await dispatchAlerts(contextFor(orgId, incidentId));

    const call = target.received[0]!;
    const wrong = createHmac('sha256', 'whsec_attacker').update(`${call.timestamp}.${call.body}`).digest('hex');
    expect(call.signature).not.toBe(wrong);
  });

  it('covers the timestamp in the signature so a captured request cannot be replayed forever', async () => {
    const target = await receiver();
    const { token, orgId } = await signup('w3@example.com', 'WOrg3');
    const created = await request(app)
      .post('/api/v1/alerts/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'webhook', target: target.url });
    const secret = created.body.data.secret as string;

    const { incidentId } = await createDownMonitorWithIncident(token);
    await dispatchAlerts(contextFor(orgId, incidentId));

    const call = target.received[0]!;
    // Re-signing the same body under a different timestamp must not match.
    expect(signPayload(secret, '9999999999', call.body)).not.toBe(call.signature);
  });

  it('logs a non-2xx response as failed with its status code', async () => {
    const target = await receiver((res) => {
      res.writeHead(500);
      res.end('boom');
    });
    const { token, orgId } = await signup('w4@example.com', 'WOrg4');
    await request(app)
      .post('/api/v1/alerts/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'webhook', target: target.url });

    const { incidentId } = await createDownMonitorWithIncident(token);
    await dispatchAlerts(contextFor(orgId, incidentId));

    const log = await pool.query<{ status: string; response_code: number; channel: string }>(
      `SELECT status, response_code, channel FROM alert_deliveries`,
    );
    expect(log.rows[0]).toMatchObject({ status: 'failed', response_code: 500, channel: 'webhook' });
  });

  it('logs an unreachable endpoint as failed without throwing', async () => {
    const { token, orgId } = await signup('w5@example.com', 'WOrg5');
    await request(app)
      .post('/api/v1/alerts/channels')
      .set('Authorization', `Bearer ${token}`)
      // Port 1 is reserved and never listening.
      .send({ type: 'webhook', target: 'http://127.0.0.1:1/hook' });

    const { incidentId } = await createDownMonitorWithIncident(token);
    await expect(dispatchAlerts(contextFor(orgId, incidentId))).resolves.toBeUndefined();

    const log = await pool.query<{ status: string; error: string }>(
      `SELECT status, error FROM alert_deliveries`,
    );
    expect(log.rows[0]!.status).toBe('failed');
    expect(log.rows[0]!.error).toBeTruthy();
  });

  it('does not attempt redelivery -- one attempt per incident edge', async () => {
    const target = await receiver((res) => {
      res.writeHead(503);
      res.end('unavailable');
    });
    const { token, orgId } = await signup('w6@example.com', 'WOrg6');
    await request(app)
      .post('/api/v1/alerts/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'webhook', target: target.url });

    const { incidentId } = await createDownMonitorWithIncident(token);
    await dispatchAlerts(contextFor(orgId, incidentId));

    // Single-attempt delivery (DECISIONS.md #23): reliable retry needs a queue, and #4
    // deliberately has none, so failing once is honest rather than pretending otherwise.
    expect(target.received).toHaveLength(1);
  });

  it('never returns the webhook secret from any read endpoint', async () => {
    const target = await receiver();
    const { token } = await signup('w7@example.com', 'WOrg7');
    const created = await request(app)
      .post('/api/v1/alerts/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'webhook', target: target.url });
    const secret = created.body.data.secret as string;

    const list = await request(app).get('/api/v1/alerts/channels').set('Authorization', `Bearer ${token}`);
    expect(JSON.stringify(list.body)).not.toContain(secret);
  });

  it('delivers to email and webhook channels together', async () => {
    const target = await receiver();
    const { token, orgId } = await signup('w8@example.com', 'WOrg8');
    await request(app)
      .post('/api/v1/alerts/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'webhook', target: target.url });
    await request(app)
      .post('/api/v1/alerts/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'email', target: 'oncall@example.com' });

    const { incidentId } = await createDownMonitorWithIncident(token);
    await dispatchAlerts(contextFor(orgId, incidentId));

    const log = await pool.query<{ channel: string }>(
      `SELECT channel FROM alert_deliveries ORDER BY channel`,
    );
    expect(log.rows.map((r) => r.channel)).toEqual(['email', 'webhook']);
  });
});
