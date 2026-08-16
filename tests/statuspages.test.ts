import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import type { CheckResult } from '../src/modules/checker/checker.http.js';
import { recordCheckResult } from '../src/modules/checker/checker.service.js';
import { closeDb, resetDb } from './helpers/db.js';

beforeEach(resetDb);
afterAll(closeDb);

const OK: CheckResult = { success: true, statusCode: 200, responseTimeMs: 5, error: null };
const FAIL: CheckResult = { success: false, statusCode: 500, responseTimeMs: 5, error: null };

async function signup(email: string, organizationName: string) {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email, password: 'password123', organizationName });
  return {
    token: res.body.data.accessToken as string,
    slug: res.body.data.organization.slug as string,
  };
}

async function createMonitor(token: string, name: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/monitors')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name,
      url: 'https://example.com',
      intervalSeconds: 60,
      timeoutSeconds: 10,
      failureThreshold: 2,
      recoveryThreshold: 2,
    });
  return res.body.data.monitor.id as string;
}

describe('public status page', () => {
  it('is readable without authentication', async () => {
    const { slug } = await signup('s1@example.com', 'Status Org One');

    const res = await request(app).get(`/api/v1/status/${slug}`).expect(200);
    expect(res.body.data.organization).toMatchObject({ name: 'Status Org One', slug });
  });

  it('returns 404 for an unknown slug', async () => {
    await request(app).get('/api/v1/status/no-such-org').expect(404);
  });

  it('reports operational when every monitor is up', async () => {
    const { token, slug } = await signup('s2@example.com', 'Status Org Two');
    const monitorId = await createMonitor(token, 'API');
    await recordCheckResult(monitorId, OK);

    const res = await request(app).get(`/api/v1/status/${slug}`).expect(200);
    expect(res.body.data.overallStatus).toBe('operational');
    expect(res.body.data.monitors[0]).toMatchObject({ name: 'API', status: 'operational' });
  });

  it('reports degraded when only some monitors are down', async () => {
    const { token, slug } = await signup('s3@example.com', 'Status Org Three');
    const up = await createMonitor(token, 'Healthy');
    const down = await createMonitor(token, 'Broken');
    await recordCheckResult(up, OK);
    await recordCheckResult(down, FAIL);
    await recordCheckResult(down, FAIL);

    const res = await request(app).get(`/api/v1/status/${slug}`).expect(200);
    expect(res.body.data.overallStatus).toBe('degraded');
  });

  it('reports a major outage only when everything is down', async () => {
    const { token, slug } = await signup('s4@example.com', 'Status Org Four');
    const a = await createMonitor(token, 'A');
    const b = await createMonitor(token, 'B');
    for (const id of [a, b]) {
      await recordCheckResult(id, FAIL);
      await recordCheckResult(id, FAIL);
    }

    const res = await request(app).get(`/api/v1/status/${slug}`).expect(200);
    expect(res.body.data.overallStatus).toBe('major_outage');
  });

  // suspected_down is SitePulse still making up its mind -- publishing that wording would
  // claim an outage the system hasn't confirmed. It surfaces as the vaguer "degraded".
  it('publishes suspected_down as degraded rather than leaking internal state names', async () => {
    const { token, slug } = await signup('s5@example.com', 'Status Org Five');
    const monitorId = await createMonitor(token, 'Wobbly');
    await recordCheckResult(monitorId, FAIL); // one failure of two: suspected_down

    const res = await request(app).get(`/api/v1/status/${slug}`).expect(200);
    expect(res.body.data.monitors[0].status).toBe('degraded');
    expect(JSON.stringify(res.body)).not.toContain('suspected');
  });

  it('reports unknown for a monitor that has never been checked', async () => {
    const { token, slug } = await signup('s6@example.com', 'Status Org Six');
    await createMonitor(token, 'Brand New');

    const res = await request(app).get(`/api/v1/status/${slug}`).expect(200);
    expect(res.body.data.monitors[0]).toMatchObject({ status: 'unknown', uptime24h: null });
  });

  it('computes 24h uptime from check history', async () => {
    const { token, slug } = await signup('s7@example.com', 'Status Org Seven');
    const monitorId = await createMonitor(token, 'Mixed');
    await recordCheckResult(monitorId, OK);
    await recordCheckResult(monitorId, OK);
    await recordCheckResult(monitorId, OK);
    await recordCheckResult(monitorId, FAIL);

    const res = await request(app).get(`/api/v1/status/${slug}`).expect(200);
    expect(res.body.data.monitors[0].uptime24h).toBe(75);
  });

  it('ignores checks older than the 24h window', async () => {
    const { token, slug } = await signup('s8@example.com', 'Status Org Eight');
    const monitorId = await createMonitor(token, 'Aged');
    await recordCheckResult(monitorId, FAIL);
    await pool.query(`UPDATE checks SET checked_at = now() - interval '30 hours' WHERE monitor_id = $1`, [
      monitorId,
    ]);
    await recordCheckResult(monitorId, OK);

    const res = await request(app).get(`/api/v1/status/${slug}`).expect(200);
    expect(res.body.data.monitors[0].uptime24h).toBe(100);
  });

  it('lists both auto and manual incidents', async () => {
    const { token, slug } = await signup('s9@example.com', 'Status Org Nine');
    const monitorId = await createMonitor(token, 'Failing');
    await recordCheckResult(monitorId, FAIL);
    await recordCheckResult(monitorId, FAIL);

    await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Scheduled maintenance' })
      .expect(201);

    const res = await request(app).get(`/api/v1/status/${slug}`).expect(200);
    const titles = (res.body.data.incidents as { title: string }[]).map((i) => i.title);
    expect(titles).toContain('Scheduled maintenance');
    expect(titles).toContain('Failing is down');
  });

  it('never exposes another organization\'s monitors', async () => {
    const a = await signup('s10a@example.com', 'Status Org TenA');
    const b = await signup('s10b@example.com', 'Status Org TenB');
    await createMonitor(a.token, 'Org A Secret Service');
    await createMonitor(b.token, 'Org B Service');

    const res = await request(app).get(`/api/v1/status/${b.slug}`).expect(200);
    const names = (res.body.data.monitors as { name: string }[]).map((m) => m.name);
    expect(names).toEqual(['Org B Service']);
  });

  // A public page must not become an accidental disclosure surface: URLs, thresholds and
  // internal ids are operator detail, not public status.
  it('does not expose monitor URLs, thresholds, or internal identifiers', async () => {
    const { token, slug } = await signup('s11@example.com', 'Status Org Eleven');
    await createMonitor(token, 'Internal API');

    const res = await request(app).get(`/api/v1/status/${slug}`).expect(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('https://example.com');
    expect(body).not.toContain('failureThreshold');
    expect(body).not.toContain('organizationId');
  });

  it('sets a short cache header to survive refresh storms during an outage', async () => {
    const { slug } = await signup('s12@example.com', 'Status Org Twelve');
    const res = await request(app).get(`/api/v1/status/${slug}`).expect(200);
    expect(res.headers['cache-control']).toContain('max-age=15');
  });
});
