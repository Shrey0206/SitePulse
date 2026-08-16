import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import {
  broadcastToOrg,
  closeAllConnections,
  getConnectionCount,
} from '../src/modules/sse/sse.hub.js';
import { _resetTicketsForTests, consumeTicket, issueTicket } from '../src/modules/sse/sse.tickets.js';
import { closeDb, resetDb } from './helpers/db.js';

// A real listening server, rather than supertest's ephemeral one, so the raw socket can be
// destroyed deliberately. Supertest's abort surfaces a socket-level error that its own
// error handler never sees, which shows up as an unhandled error in the run.
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await resetDb();
  _resetTicketsForTests();
});
afterEach(closeAllConnections);
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDb();
});

async function signup(email: string, organizationName: string) {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email, password: 'password123', organizationName });
  return {
    token: res.body.data.accessToken as string,
    orgId: res.body.data.user.organizationId as string,
    userId: res.body.data.user.id as string,
  };
}

/**
 * Opens a real SSE stream and reads frames until `stopWhen` is satisfied, then destroys
 * the socket. An SSE response never completes on its own, so the test has to decide when
 * it has seen enough.
 */
function readStream(
  ticket: string,
  stopWhen: (body: string) => boolean = (body) => body.includes('event: connected'),
): Promise<{ statusCode: number; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}/api/v1/sse?ticket=${ticket}`, (res) => {
      let body = '';
      const done = () => {
        res.destroy();
        req.destroy();
        resolve({
          statusCode: res.statusCode ?? 0,
          contentType: String(res.headers['content-type'] ?? ''),
          body,
        });
      };

      if (res.statusCode !== 200) {
        res.on('data', () => undefined);
        res.on('end', done);
        return;
      }

      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
        if (stopWhen(body)) done();
      });
    });

    // Destroying the request after a deliberate read is normal here, not a failure.
    req.on('error', (err: Error & { code?: string }) => {
      if (err.code === 'ECONNRESET') return;
      reject(err);
    });
  });
}

describe('SSE tickets', () => {
  it('requires authentication to mint a ticket', async () => {
    await request(app).post('/api/v1/sse/ticket').expect(401);
  });

  it('issues a ticket to an authenticated caller', async () => {
    const { token } = await signup('t1@example.com', 'TOrg1');
    const res = await request(app)
      .post('/api/v1/sse/ticket')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(typeof res.body.data.ticket).toBe('string');
    expect(res.body.data.expiresIn).toBeGreaterThan(0);
  });

  // Single-use is the property that makes a ticket in a URL acceptable: even if it lands
  // in a server access log, it's already spent (DECISIONS.md #27).
  it('consumes a ticket on first use so a replay fails', () => {
    const { ticket } = issueTicket('user-1', 'org-1');

    expect(consumeTicket(ticket)).toMatchObject({ userId: 'user-1', orgId: 'org-1' });
    expect(consumeTicket(ticket)).toBeNull();
  });

  it('rejects an unknown ticket', () => {
    expect(consumeTicket('never-issued')).toBeNull();
  });

  it('issues distinct tickets each time', () => {
    const a = issueTicket('u', 'o').ticket;
    const b = issueTicket('u', 'o').ticket;
    expect(a).not.toBe(b);
  });
});

describe('SSE stream', () => {
  it('rejects a connection with no ticket', async () => {
    await request(app).get('/api/v1/sse').expect(401);
  });

  it('rejects a connection with an invalid ticket', async () => {
    await request(app).get('/api/v1/sse?ticket=bogus').expect(401);
  });

  it('rejects an access token used directly as a ticket', async () => {
    const { token } = await signup('t2@example.com', 'TOrg2');
    // The stream must not accept the bearer credential in the query string -- the whole
    // point of the ticket indirection is keeping it out of URLs.
    await request(app).get(`/api/v1/sse?ticket=${token}`).expect(401);
  });

  it('rejects a ticket that has already been used to open a stream', async () => {
    const { token } = await signup('t3@example.com', 'TOrg3');
    const minted = await request(app).post('/api/v1/sse/ticket').set('Authorization', `Bearer ${token}`);
    const ticket = minted.body.data.ticket as string;

    await readStream(ticket);

    await request(app).get(`/api/v1/sse?ticket=${ticket}`).expect(401);
  });

  it('opens a stream with SSE headers, a retry hint and a connected event', async () => {
    const { token } = await signup('t4@example.com', 'TOrg4');
    const minted = await request(app).post('/api/v1/sse/ticket').set('Authorization', `Bearer ${token}`);

    const stream = await readStream(minted.body.data.ticket as string);

    expect(stream.contentType).toContain('text/event-stream');
    expect(stream.body).toContain('event: connected');
    // retry: tells EventSource how long to wait before reconnecting.
    expect(stream.body).toContain('retry:');
  });
});

describe('SSE fan-out', () => {
  it('does not throw when broadcasting to an org with no listeners', () => {
    expect(() => broadcastToOrg('nobody-here', { type: 'monitor_status_changed', data: {} })).not.toThrow();
  });

  it('delivers a broadcast event to a connected client', async () => {
    const { token, orgId } = await signup('t5@example.com', 'TOrg5');
    const minted = await request(app).post('/api/v1/sse/ticket').set('Authorization', `Bearer ${token}`);

    const streamPromise = readStream(minted.body.data.ticket as string, (body) =>
      body.includes('monitor_status_changed'),
    );

    // Wait for the connection to register before broadcasting, otherwise the event is
    // published to nobody and the read hangs.
    await new Promise((resolve) => setTimeout(resolve, 200));
    broadcastToOrg(orgId, {
      type: 'monitor_status_changed',
      data: { monitorId: 'abc', status: 'down' },
    });

    const stream = await streamPromise;
    expect(stream.body).toContain('event: monitor_status_changed');
    expect(stream.body).toContain('"status":"down"');
  });

  // Tenant isolation on the live channel: SSE bypasses the per-query org scoping used
  // everywhere else, so fan-out has to enforce it itself.
  it('does not deliver one organization\'s events to another\'s connection', async () => {
    const a = await signup('t6a@example.com', 'TOrg6A');
    const b = await signup('t6b@example.com', 'TOrg6B');
    const minted = await request(app).post('/api/v1/sse/ticket').set('Authorization', `Bearer ${a.token}`);

    const streamPromise = readStream(minted.body.data.ticket as string, (body) =>
      body.includes('sentinel-for-org-a'),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(getConnectionCount(a.orgId)).toBe(1);
    expect(getConnectionCount(b.orgId)).toBe(0);

    // Org B's event must not reach org A's stream; the sentinel afterwards proves the
    // stream was live and simply never received B's event.
    broadcastToOrg(b.orgId, { type: 'incident_opened', data: { secret: 'org-b-only' } });
    broadcastToOrg(a.orgId, { type: 'incident_opened', data: { marker: 'sentinel-for-org-a' } });

    const stream = await streamPromise;
    expect(stream.body).not.toContain('org-b-only');
    expect(stream.body).toContain('sentinel-for-org-a');
  });
});
