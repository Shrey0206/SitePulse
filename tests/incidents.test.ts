import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { recordCheckResult } from '../src/modules/checker/checker.service.js';
import type { CheckResult } from '../src/modules/checker/checker.http.js';
import { closeDb, resetDb } from './helpers/db.js';

beforeEach(resetDb);
afterAll(closeDb);

async function signup(email: string, organizationName: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email, password: 'password123', organizationName });
  return res.body.data.accessToken as string;
}

async function createMonitor(token: string, overrides: Record<string, unknown> = {}): Promise<string> {
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
      ...overrides,
    });
  return res.body.data.monitor.id as string;
}

const OK: CheckResult = { success: true, statusCode: 200, responseTimeMs: 12, error: null };
const FAIL: CheckResult = { success: false, statusCode: 500, responseTimeMs: 12, error: null };

/** Drives real check writes through the same path the scheduler uses. */
async function check(monitorId: string, results: CheckResult[]): Promise<void> {
  for (const result of results) {
    await recordCheckResult(monitorId, result);
  }
}

async function openAutoIncidents(monitorId: string): Promise<number> {
  const res = await pool.query(
    `SELECT 1 FROM incidents WHERE monitor_id = $1 AND source = 'auto' AND resolved_at IS NULL`,
    [monitorId],
  );
  return res.rowCount ?? 0;
}

describe('auto-incident invariant', () => {
  it('opens exactly one incident when a monitor is confirmed down', async () => {
    const token = await signup('i1@example.com', 'Org1');
    const monitorId = await createMonitor(token);

    await check(monitorId, [FAIL]);
    expect(await openAutoIncidents(monitorId)).toBe(0); // suspected_down only

    await check(monitorId, [FAIL]);
    expect(await openAutoIncidents(monitorId)).toBe(1);
  });

  it('does not open a second incident while the monitor stays down', async () => {
    const token = await signup('i2@example.com', 'Org2');
    const monitorId = await createMonitor(token);

    await check(monitorId, [FAIL, FAIL, FAIL, FAIL, FAIL]);
    expect(await openAutoIncidents(monitorId)).toBe(1);
  });

  it('resolves the incident once the monitor is confirmed up', async () => {
    const token = await signup('i3@example.com', 'Org3');
    const monitorId = await createMonitor(token);

    await check(monitorId, [FAIL, FAIL]);
    expect(await openAutoIncidents(monitorId)).toBe(1);

    await check(monitorId, [OK, OK]);
    expect(await openAutoIncidents(monitorId)).toBe(0);
  });

  it('opens a fresh incident for a second outage after recovery', async () => {
    const token = await signup('i4@example.com', 'Org4');
    const monitorId = await createMonitor(token);

    await check(monitorId, [FAIL, FAIL, OK, OK, FAIL, FAIL]);

    const all = await pool.query(`SELECT resolved_at FROM incidents WHERE monitor_id = $1`, [monitorId]);
    expect(all.rowCount).toBe(2);
    expect(await openAutoIncidents(monitorId)).toBe(1);
  });

  // The bug DECISIONS.md #28 exists to prevent: with edge-triggered creation, manually
  // resolving while the monitor is still down leaves the status page claiming
  // "operational" forever, because no further transition ever fires to reopen it.
  it('reopens an incident when one is manually resolved while the monitor is still down', async () => {
    const token = await signup('i5@example.com', 'Org5');
    const monitorId = await createMonitor(token);

    await check(monitorId, [FAIL, FAIL]);
    const incidentId = (
      await pool.query<{ id: string }>(`SELECT id FROM incidents WHERE monitor_id = $1`, [monitorId])
    ).rows[0]!.id;

    await request(app)
      .post(`/api/v1/incidents/${incidentId}/resolve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(await openAutoIncidents(monitorId)).toBe(0);

    // Monitor is still down, so the very next check write must re-assert the invariant.
    await check(monitorId, [FAIL]);
    expect(await openAutoIncidents(monitorId)).toBe(1);
  });

  it('leaves incidents untouched during suspected_* states', async () => {
    const token = await signup('i6@example.com', 'Org6');
    const monitorId = await createMonitor(token, { failureThreshold: 3, recoveryThreshold: 3 });

    await check(monitorId, [FAIL, FAIL, FAIL]);
    expect(await openAutoIncidents(monitorId)).toBe(1);

    // One success mid-outage moves to suspected_up but must not resolve the incident.
    await check(monitorId, [OK]);
    expect(await openAutoIncidents(monitorId)).toBe(1);
  });

  it('enforces at most one open auto incident per monitor at the database level', async () => {
    const token = await signup('i7@example.com', 'Org7');
    const monitorId = await createMonitor(token);
    await check(monitorId, [FAIL, FAIL]);

    const orgId = (
      await pool.query<{ organization_id: string }>(`SELECT organization_id FROM monitors WHERE id = $1`, [
        monitorId,
      ])
    ).rows[0]!.organization_id;

    await expect(
      pool.query(
        `INSERT INTO incidents (organization_id, monitor_id, source, title) VALUES ($1, $2, 'auto', 'dupe')`,
        [orgId, monitorId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('manual incidents', () => {
  it('creates a manual incident without a monitor', async () => {
    const token = await signup('m1@example.com', 'MOrg1');
    const res = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Planned maintenance', description: 'Upgrading the database' })
      .expect(201);

    expect(res.body.data.incident).toMatchObject({
      source: 'manual',
      monitorId: null,
      title: 'Planned maintenance',
      resolvedAt: null,
    });
  });

  it('rejects a manual incident pointing at another org\'s monitor', async () => {
    const tokenA = await signup('m2a@example.com', 'MOrg2A');
    const tokenB = await signup('m2b@example.com', 'MOrg2B');
    const monitorId = await createMonitor(tokenA);

    await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ title: 'Not mine', monitorId })
      .expect(404);
  });

  // Manual and auto incidents coexist: a maintenance window must not suppress or merge
  // with a real outage on the same monitor (DECISIONS.md #28).
  it('keeps a manual incident independent of the auto incident on the same monitor', async () => {
    const token = await signup('m3@example.com', 'MOrg3');
    const monitorId = await createMonitor(token);

    await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Maintenance', monitorId })
      .expect(201);

    await check(monitorId, [FAIL, FAIL]);

    const res = await request(app)
      .get('/api/v1/incidents')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const sources = (res.body.data.incidents as { source: string }[]).map((i) => i.source).sort();
    expect(sources).toEqual(['auto', 'manual']);
  });

  it('refuses to edit an auto incident', async () => {
    const token = await signup('m4@example.com', 'MOrg4');
    const monitorId = await createMonitor(token);
    await check(monitorId, [FAIL, FAIL]);

    const incidentId = (
      await pool.query<{ id: string }>(`SELECT id FROM incidents WHERE monitor_id = $1`, [monitorId])
    ).rows[0]!.id;

    await request(app)
      .patch(`/api/v1/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Hand-edited' })
      .expect(404);
  });

  it('filters by open and resolved status', async () => {
    const token = await signup('m5@example.com', 'MOrg5');
    const created = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'To resolve' });

    await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Stays open' });

    await request(app)
      .post(`/api/v1/incidents/${created.body.data.incident.id}/resolve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const open = await request(app)
      .get('/api/v1/incidents?status=open')
      .set('Authorization', `Bearer ${token}`);
    const resolved = await request(app)
      .get('/api/v1/incidents?status=resolved')
      .set('Authorization', `Bearer ${token}`);

    expect(open.body.data.incidents).toHaveLength(1);
    expect(open.body.data.incidents[0].title).toBe('Stays open');
    expect(resolved.body.data.incidents).toHaveLength(1);
    expect(resolved.body.data.incidents[0].title).toBe('To resolve');
  });

  it('rejects resolving an already-resolved incident', async () => {
    const token = await signup('m6@example.com', 'MOrg6');
    const created = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Once' });
    const id = created.body.data.incident.id as string;

    await request(app).post(`/api/v1/incidents/${id}/resolve`).set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).post(`/api/v1/incidents/${id}/resolve`).set('Authorization', `Bearer ${token}`).expect(409);
  });

  it('does not leak incidents across organizations', async () => {
    const tokenA = await signup('m7a@example.com', 'MOrg7A');
    const tokenB = await signup('m7b@example.com', 'MOrg7B');

    const created = await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Org A only' });
    const id = created.body.data.incident.id as string;

    await request(app).get(`/api/v1/incidents/${id}`).set('Authorization', `Bearer ${tokenB}`).expect(404);
    await request(app).delete(`/api/v1/incidents/${id}`).set('Authorization', `Bearer ${tokenB}`).expect(404);

    const listB = await request(app).get('/api/v1/incidents').set('Authorization', `Bearer ${tokenB}`);
    expect(listB.body.data.incidents).toHaveLength(0);
  });
});
