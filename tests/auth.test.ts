import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { closeDb, resetDb } from './helpers/db.js';

beforeEach(resetDb);
afterAll(closeDb);

function extractCookieValue(res: request.Response, name: string): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const line = raw?.find((c) => c.startsWith(`${name}=`));
  if (!line) throw new Error(`cookie ${name} was not set`);
  return line.split(';')[0]!.split('=')[1]!;
}

describe('auth', () => {
  it('signs up a new user and organization, without leaking the refresh token into the body', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'a@example.com', password: 'password123', organizationName: 'Acme' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('a@example.com');
    expect(res.body.data.organization.slug).toBe('acme');
    expect(res.body.data.accessToken).toBeTypeOf('string');
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(extractCookieValue(res, 'refreshToken')).toBeTypeOf('string');
  });

  it('rejects a duplicate email with 409', async () => {
    await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'dup@example.com', password: 'password123', organizationName: 'Org1' });

    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'dup@example.com', password: 'password123', organizationName: 'Org2' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('resolves an organization slug collision with a random suffix', async () => {
    const first = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'u1@example.com', password: 'password123', organizationName: 'Acme' });
    const second = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'u2@example.com', password: 'password123', organizationName: 'Acme' });

    expect(first.body.data.organization.slug).toBe('acme');
    expect(second.body.data.organization.slug).toMatch(/^acme-[0-9a-f]{6}$/);
  });

  it('logs in with correct credentials', async () => {
    await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'login@example.com', password: 'password123', organizationName: 'Org' });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'login@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTypeOf('string');
  });

  it('rejects the wrong password and an unknown email with the same error', async () => {
    await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'wrong@example.com', password: 'password123', organizationName: 'Org' });

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'wrong@example.com', password: 'incorrect1' });
    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@example.com', password: 'whatever1' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects malformed signup input with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'not-an-email', password: 'short', organizationName: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rotates the refresh token and issues a new access token', async () => {
    const signupRes = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'rotate@example.com', password: 'password123', organizationName: 'Org' });
    const originalCookie = extractCookieValue(signupRes, 'refreshToken');

    const refreshRes = await request(app).post('/api/v1/auth/refresh').set('Cookie', `refreshToken=${originalCookie}`);

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.accessToken).toBeTypeOf('string');
    // Not asserting the new access token differs from the old one: JWT `iat` has
    // 1-second granularity, so two tokens for the same user minted in the same second
    // are byte-identical -- harmless, and not what this test is actually checking. The
    // refresh token (the thing that's supposed to rotate every use) is what matters here.
    expect(extractCookieValue(refreshRes, 'refreshToken')).not.toBe(originalCookie);
  });

  it('detects refresh token reuse and revokes the whole family', async () => {
    const signupRes = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'reuse@example.com', password: 'password123', organizationName: 'Org' });
    const originalCookie = extractCookieValue(signupRes, 'refreshToken');

    const firstRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refreshToken=${originalCookie}`);
    const rotatedCookie = extractCookieValue(firstRefresh, 'refreshToken');

    // Reusing the already-rotated original token is the attack/double-submit scenario.
    const reuseAttempt = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refreshToken=${originalCookie}`);
    expect(reuseAttempt.status).toBe(401);

    // The still-"valid" rotated token must be dead too -- the whole family was revoked.
    const afterReuse = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refreshToken=${rotatedCookie}`);
    expect(afterReuse.status).toBe(401);
  });

  it('revokes the refresh token on logout', async () => {
    const signupRes = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'logout@example.com', password: 'password123', organizationName: 'Org' });
    const cookie = extractCookieValue(signupRes, 'refreshToken');

    const logoutRes = await request(app).post('/api/v1/auth/logout').set('Cookie', `refreshToken=${cookie}`);
    expect(logoutRes.status).toBe(200);

    const refreshAfterLogout = await request(app).post('/api/v1/auth/refresh').set('Cookie', `refreshToken=${cookie}`);
    expect(refreshAfterLogout.status).toBe(401);
  });
});
