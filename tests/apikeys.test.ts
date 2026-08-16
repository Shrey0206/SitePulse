import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { hashApiKey } from '../src/modules/apikeys/apikeys.service.js';
import { closeDb, resetDb } from './helpers/db.js';

beforeEach(resetDb);
afterAll(closeDb);

async function signup(email: string, organizationName: string) {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email, password: 'password123', organizationName });
  return { token: res.body.data.accessToken as string, orgId: res.body.data.user.organizationId as string };
}

async function createKey(token: string, name = 'CI pipeline'): Promise<{ key: string; id: string }> {
  const res = await request(app)
    .post('/api/v1/keys')
    .set('Authorization', `Bearer ${token}`)
    .send({ name })
    .expect(201);
  return { key: res.body.data.key as string, id: res.body.data.apiKey.id as string };
}

describe('API key management', () => {
  it('issues a prefixed key and returns it exactly once', async () => {
    const { token } = await signup('k1@example.com', 'KOrg1');
    const res = await request(app)
      .post('/api/v1/keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'CI pipeline' })
      .expect(201);

    expect(res.body.data.key).toMatch(/^sp_live_/);
    expect(res.body.data.apiKey.keyPrefix).toBe((res.body.data.key as string).slice(0, 16));

    // Never retrievable again -- only the hash is stored.
    const list = await request(app).get('/api/v1/keys').set('Authorization', `Bearer ${token}`);
    expect(JSON.stringify(list.body)).not.toContain(res.body.data.key);
  });

  it('stores only a SHA-256 hash, never the key itself', async () => {
    const { token } = await signup('k2@example.com', 'KOrg2');
    const { key } = await createKey(token);

    const row = await pool.query<{ key_hash: string }>(`SELECT key_hash FROM api_keys`);
    expect(row.rows[0]!.key_hash).toBe(hashApiKey(key));
    expect(row.rows[0]!.key_hash).not.toContain(key);
  });

  it('requires a session to manage keys, not a key', async () => {
    const { token } = await signup('k3@example.com', 'KOrg3');
    const { key } = await createKey(token);

    // A leaked key must not be able to mint further keys and entrench itself.
    await request(app).get('/api/v1/keys').set('X-API-Key', key).expect(401);
    await request(app).post('/api/v1/keys').set('X-API-Key', key).send({ name: 'escalation' }).expect(401);
  });

  it('does not leak keys across organizations', async () => {
    const a = await signup('k4a@example.com', 'KOrg4A');
    const b = await signup('k4b@example.com', 'KOrg4B');
    const { id } = await createKey(a.token);

    await request(app).delete(`/api/v1/keys/${id}`).set('Authorization', `Bearer ${b.token}`).expect(404);

    const list = await request(app).get('/api/v1/keys').set('Authorization', `Bearer ${b.token}`);
    expect(list.body.data.apiKeys).toHaveLength(0);
  });
});

describe('API key authentication', () => {
  it('authenticates a request to monitors with a valid key', async () => {
    const { token } = await signup('k5@example.com', 'KOrg5');
    const { key } = await createKey(token);

    await request(app)
      .post('/api/v1/monitors')
      .set('X-API-Key', key)
      .send({ name: 'Via API', url: 'https://example.com', intervalSeconds: 60, timeoutSeconds: 10 })
      .expect(201);

    const list = await request(app).get('/api/v1/monitors').set('X-API-Key', key).expect(200);
    expect(list.body.data.monitors).toHaveLength(1);
  });

  it('scopes API-key requests to the key\'s own organization', async () => {
    const a = await signup('k6a@example.com', 'KOrg6A');
    const b = await signup('k6b@example.com', 'KOrg6B');
    const keyA = (await createKey(a.token)).key;

    await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ name: 'Org B only', url: 'https://example.com', intervalSeconds: 60, timeoutSeconds: 10 });

    const list = await request(app).get('/api/v1/monitors').set('X-API-Key', keyA).expect(200);
    expect(list.body.data.monitors).toHaveLength(0);
  });

  it('rejects an unknown key', async () => {
    await request(app).get('/api/v1/monitors').set('X-API-Key', 'sp_live_totally_made_up').expect(401);
  });

  it('rejects a key without the expected prefix', async () => {
    await request(app).get('/api/v1/monitors').set('X-API-Key', 'not-a-sitepulse-key').expect(401);
  });

  it('rejects a revoked key', async () => {
    const { token } = await signup('k7@example.com', 'KOrg7');
    const { key, id } = await createKey(token);

    await request(app).get('/api/v1/monitors').set('X-API-Key', key).expect(200);
    await request(app).delete(`/api/v1/keys/${id}`).set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v1/monitors').set('X-API-Key', key).expect(401);
  });

  it('keeps a revoked key listed so it stays identifiable in logs', async () => {
    const { token } = await signup('k8@example.com', 'KOrg8');
    const { id } = await createKey(token);
    await request(app).delete(`/api/v1/keys/${id}`).set('Authorization', `Bearer ${token}`).expect(200);

    const list = await request(app).get('/api/v1/keys').set('Authorization', `Bearer ${token}`);
    expect(list.body.data.apiKeys).toHaveLength(1);
    expect(list.body.data.apiKeys[0].revokedAt).not.toBeNull();
  });

  it('refuses to revoke an already-revoked key', async () => {
    const { token } = await signup('k9@example.com', 'KOrg9');
    const { id } = await createKey(token);
    await request(app).delete(`/api/v1/keys/${id}`).set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).delete(`/api/v1/keys/${id}`).set('Authorization', `Bearer ${token}`).expect(404);
  });

  it('records last_used_at when a key authenticates', async () => {
    const { token } = await signup('k10@example.com', 'KOrg10');
    const { key, id } = await createKey(token);

    await request(app).get('/api/v1/monitors').set('X-API-Key', key).expect(200);
    // The write is fire-and-forget to keep it out of the hot path, so allow it to land.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const row = await pool.query<{ last_used_at: Date | null }>(
      `SELECT last_used_at FROM api_keys WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]!.last_used_at).not.toBeNull();
  });

  it('grants full access within the org, since v1 keys are not scoped', async () => {
    const { token } = await signup('k11@example.com', 'KOrg11');
    const { key } = await createKey(token);

    // DECISIONS.md #37: full-access, non-expiring. Asserted so the stated v1 boundary is
    // visible rather than implied.
    const created = await request(app)
      .post('/api/v1/monitors')
      .set('X-API-Key', key)
      .send({ name: 'M', url: 'https://example.com', intervalSeconds: 60, timeoutSeconds: 10 })
      .expect(201);

    await request(app)
      .patch(`/api/v1/monitors/${created.body.data.monitor.id}`)
      .set('X-API-Key', key)
      .send({ name: 'Renamed' })
      .expect(200);

    await request(app)
      .delete(`/api/v1/monitors/${created.body.data.monitor.id}`)
      .set('X-API-Key', key)
      .expect(204);
  });

  it('does not issue SSE tickets to API keys', async () => {
    const { token } = await signup('k12@example.com', 'KOrg12');
    const { key } = await createKey(token);

    // A live dashboard stream belongs to a user session, not a programmatic key.
    await request(app).post('/api/v1/sse/ticket').set('X-API-Key', key).expect(401);
  });
});
