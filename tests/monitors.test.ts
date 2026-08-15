import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { closeDb, resetDb } from './helpers/db.js';

beforeEach(resetDb);
afterAll(closeDb);

async function signup(email: string, organizationName: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email, password: 'password123', organizationName });
  return res.body.data.accessToken as string;
}

const validMonitor = {
  name: 'My Site',
  url: 'https://example.com',
  intervalSeconds: 60,
  timeoutSeconds: 10,
};

describe('monitors', () => {
  it('creates a monitor with defaults applied', async () => {
    const token = await signup('m1@example.com', 'Org1');

    const res = await request(app).post('/api/v1/monitors').set('Authorization', `Bearer ${token}`).send(validMonitor);

    expect(res.status).toBe(201);
    expect(res.body.data.monitor.expectedStatus).toBe(200);
    expect(res.body.data.monitor.failureThreshold).toBe(3);
    expect(res.body.data.monitor.recoveryThreshold).toBe(3);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/v1/monitors').send(validMonitor);
    expect(res.status).toBe(401);
  });

  it('rejects a non-http(s) url', async () => {
    const token = await signup('m2@example.com', 'Org2');

    const res = await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validMonitor, url: 'ftp://example.com' });

    expect(res.status).toBe(400);
  });

  it('rejects timeoutSeconds greater than intervalSeconds on create', async () => {
    const token = await signup('m3@example.com', 'Org3');

    const res = await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validMonitor, intervalSeconds: 10, timeoutSeconds: 20 });

    expect(res.status).toBe(400);
  });

  it('returns 400 when a partial update violates the timeout/interval CHECK constraint', async () => {
    const token = await signup('m4@example.com', 'Org4');
    const createRes = await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validMonitor, intervalSeconds: 60, timeoutSeconds: 10 });
    const monitorId = createRes.body.data.monitor.id as string;

    // intervalSeconds alone, dropped below the existing timeoutSeconds already in the DB --
    // Zod's cross-field refine only fires when both fields are in the same payload, so this
    // has to be caught by the DB CHECK constraint instead.
    const res = await request(app)
      .patch(`/api/v1/monitors/${monitorId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ intervalSeconds: 5 });

    expect(res.status).toBe(400);
  });

  it('scopes list/get/update/delete to the caller organization', async () => {
    const tokenA = await signup('a@example.com', 'OrgA');
    const tokenB = await signup('b@example.com', 'OrgB');

    const createRes = await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', `Bearer ${tokenA}`)
      .send(validMonitor);
    const monitorId = createRes.body.data.monitor.id as string;

    const listA = await request(app).get('/api/v1/monitors').set('Authorization', `Bearer ${tokenA}`);
    expect(listA.body.data.monitors).toHaveLength(1);

    const listB = await request(app).get('/api/v1/monitors').set('Authorization', `Bearer ${tokenB}`);
    expect(listB.body.data.monitors).toHaveLength(0);

    const getB = await request(app).get(`/api/v1/monitors/${monitorId}`).set('Authorization', `Bearer ${tokenB}`);
    expect(getB.status).toBe(404);

    const updateB = await request(app)
      .patch(`/api/v1/monitors/${monitorId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'Hijacked' });
    expect(updateB.status).toBe(404);

    const deleteB = await request(app).delete(`/api/v1/monitors/${monitorId}`).set('Authorization', `Bearer ${tokenB}`);
    expect(deleteB.status).toBe(404);

    const updateA = await request(app)
      .patch(`/api/v1/monitors/${monitorId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Renamed' });
    expect(updateA.status).toBe(200);
    expect(updateA.body.data.monitor.name).toBe('Renamed');

    const deleteA = await request(app).delete(`/api/v1/monitors/${monitorId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(deleteA.status).toBe(204);

    const getAfterDelete = await request(app)
      .get(`/api/v1/monitors/${monitorId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(getAfterDelete.status).toBe(404);
  });
});
