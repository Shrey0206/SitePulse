import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { closeDb, resetDb } from './helpers/db.js';

beforeEach(resetDb);
afterAll(closeDb);

describe('Week 1 vertical slice', () => {
  it('signup -> login -> create monitor -> list monitors works end-to-end', async () => {
    const signupRes = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'slice@example.com', password: 'password123', organizationName: 'Slice Org' });
    expect(signupRes.status).toBe(201);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'slice@example.com', password: 'password123' });
    expect(loginRes.status).toBe(200);
    const accessToken = loginRes.body.data.accessToken as string;

    const monitorRes = await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Production', url: 'https://example.com', intervalSeconds: 60, timeoutSeconds: 10 });
    expect(monitorRes.status).toBe(201);

    const listRes = await request(app).get('/api/v1/monitors').set('Authorization', `Bearer ${accessToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.monitors).toHaveLength(1);
    expect(listRes.body.data.monitors[0].name).toBe('Production');
  });
});
