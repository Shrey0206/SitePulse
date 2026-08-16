import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { performHttpCheck } from '../src/modules/checker/checker.http.js';
import { ensureChecksPartitions } from '../src/modules/checker/checker.partitions.js';
import { getDueMonitors, recordCheckResult } from '../src/modules/checker/checker.service.js';
import { closeDb, resetDb } from './helpers/db.js';

beforeEach(resetDb);
afterAll(closeDb);

interface Target {
  url: string;
  close: () => Promise<void>;
}

async function startTarget(handler: http.RequestListener): Promise<Target> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const openTargets: Target[] = [];
afterEach(async () => {
  await Promise.all(openTargets.splice(0).map((t) => t.close()));
});

async function target(handler: http.RequestListener): Promise<Target> {
  const t = await startTarget(handler);
  openTargets.push(t);
  return t;
}

async function signup(email: string, organizationName: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email, password: 'password123', organizationName });
  return res.body.data.accessToken as string;
}

describe('HTTP check execution', () => {
  it('treats a matching status code as success and records response time', async () => {
    const t = await target((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });

    const result = await performHttpCheck({ url: t.url, timeoutSeconds: 5, expectedStatus: 200 });

    expect(result).toMatchObject({ success: true, statusCode: 200, error: null });
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('fails when the status code differs from the expected one', async () => {
    const t = await target((_req, res) => {
      res.writeHead(404);
      res.end('nope');
    });

    // The status is still recorded -- knowing it returned 404 rather than nothing at all
    // is the difference between "wrong response" and "unreachable" when debugging.
    expect(await performHttpCheck({ url: t.url, timeoutSeconds: 5, expectedStatus: 200 })).toMatchObject({
      success: false,
      statusCode: 404,
    });
  });

  it('supports a non-200 expected status', async () => {
    const t = await target((_req, res) => {
      res.writeHead(204);
      res.end();
    });

    expect(await performHttpCheck({ url: t.url, timeoutSeconds: 5, expectedStatus: 204 })).toMatchObject({
      success: true,
      statusCode: 204,
    });
  });

  it('times out a slow endpoint via AbortController rather than hanging', async () => {
    const t = await target((_req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end('too late');
      }, 5000);
    });

    const result = await performHttpCheck({ url: t.url, timeoutSeconds: 1, expectedStatus: 200 });

    expect(result).toMatchObject({ success: false, statusCode: null, error: 'Request timed out' });
    // Proves the timeout actually fired instead of the request completing on its own.
    expect(result.responseTimeMs).toBeLessThan(3000);
  });

  it('records an unreachable host as a failure with an error and no status code', async () => {
    // Port 1 is reserved and never listening.
    expect(
      await performHttpCheck({ url: 'http://127.0.0.1:1/', timeoutSeconds: 2, expectedStatus: 200 }),
    ).toMatchObject({ success: false, statusCode: null });
  });
});

describe('due-monitor selection', () => {
  it('treats a never-checked monitor as due', async () => {
    const token = await signup('d1@example.com', 'DOrg1');
    await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'M', url: 'https://example.com', intervalSeconds: 60, timeoutSeconds: 10 });

    expect(await getDueMonitors()).toHaveLength(1);
  });

  it('stops treating a monitor as due until its interval has elapsed', async () => {
    const token = await signup('d2@example.com', 'DOrg2');
    const created = await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'M', url: 'https://example.com', intervalSeconds: 3600, timeoutSeconds: 10 });

    await recordCheckResult(created.body.data.monitor.id, {
      success: true,
      statusCode: 200,
      responseTimeMs: 5,
      error: null,
    });

    expect(await getDueMonitors()).toHaveLength(0);
  });

  it('treats a monitor as due again once its interval has passed', async () => {
    const token = await signup('d3@example.com', 'DOrg3');
    const created = await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'M', url: 'https://example.com', intervalSeconds: 10, timeoutSeconds: 5 });
    const monitorId = created.body.data.monitor.id as string;

    await recordCheckResult(monitorId, { success: true, statusCode: 200, responseTimeMs: 5, error: null });
    await pool.query(`UPDATE monitors SET last_checked_at = now() - interval '11 seconds' WHERE id = $1`, [
      monitorId,
    ]);

    expect(await getDueMonitors()).toHaveLength(1);
  });
});

describe('partition maintenance', () => {
  it('creates the current month plus a two-month lookahead', async () => {
    await ensureChecksPartitions(new Date('2027-03-15T00:00:00Z'));

    const result = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE tablename IN ('checks_2027_03','checks_2027_04','checks_2027_05')`,
    );
    expect(result.rowCount).toBe(3);
  });

  it('is idempotent, so the daily run is a no-op once partitions exist', async () => {
    const when = new Date('2027-07-10T00:00:00Z');
    await ensureChecksPartitions(when);
    await expect(ensureChecksPartitions(when)).resolves.toBeUndefined();
  });

  it('rolls the year over correctly at a December boundary', async () => {
    await ensureChecksPartitions(new Date('2027-12-05T00:00:00Z'));

    const result = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE tablename IN ('checks_2027_12','checks_2028_01','checks_2028_02')`,
    );
    expect(result.rowCount).toBe(3);
  });
});

describe('health endpoint', () => {
  it('reports database and checker status', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body).toMatchObject({ database: 'ok' });
    expect(res.body.checker).toHaveProperty('status');
  });
});
