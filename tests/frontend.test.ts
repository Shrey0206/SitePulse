import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notFoundHandler } from '../src/shared/middlewares/errorHandler.js';
import { serveFrontend } from '../src/shared/middlewares/serveFrontend.js';

describe('serveFrontend', () => {
  let dir: string;
  let app: express.Express;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'sitepulse-web-'));
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>SitePulse</title>');
    writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log("bundle");');

    app = express();
    serveFrontend(app, dir);
    app.use(notFoundHandler);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the shell at the root', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  it('falls back to the shell for client-side routes', async () => {
    for (const route of ['/dashboard/monitors', '/status/acme-1a2b3c']) {
      const res = await request(app).get(route);
      expect(res.status, route).toBe(200);
      expect(res.headers['content-type'], route).toMatch(/html/);
    }
  });

  it('serves built assets with immutable caching', async () => {
    const res = await request(app).get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('returns a real 404 for a missing asset instead of the HTML shell', async () => {
    // A stale page after a deploy still asks for the previous bundle's hashed filename.
    for (const missing of ['/assets/index-oldhash.js', '/favicon.ico']) {
      const res = await request(app).get(missing);
      expect(res.status, missing).toBe(404);
      expect(res.headers['content-type'], missing).not.toMatch(/html/);
    }
  });

  it('keeps unmatched /api paths as JSON 404s', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
