import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import {
  buildDiscordPayload,
  buildSlackPayload,
  isChatWebhookUrl,
  maskChatWebhookUrl,
  sendAlertChat,
} from '../src/modules/alerts/alerts.chat.js';
import { decryptSecret, encryptSecret } from '../src/modules/alerts/alerts.crypto.js';
import { dispatchAlerts } from '../src/modules/alerts/alerts.service.js';
import type { AlertContext } from '../src/modules/alerts/alerts.types.js';
import type { CheckResult } from '../src/modules/checker/checker.http.js';
import { recordCheckResult } from '../src/modules/checker/checker.service.js';
import { closeDb, resetDb } from './helpers/db.js';

beforeEach(resetDb);
afterAll(closeDb);

const DISCORD_URL = 'https://discord.com/api/webhooks/123456789012345678/AbC-dEf_SECRETtoken123';
const SLACK_URL = 'https://hooks.slack.com/services/T00000000/B00000000/SECRETtokenXXXXXXXXXXXX';
const FAIL: CheckResult = { success: false, statusCode: 500, responseTimeMs: 5, error: null };

function context(overrides: Partial<AlertContext> = {}): AlertContext {
  return {
    organizationId: '00000000-0000-0000-0000-000000000000',
    incidentId: '11111111-1111-1111-1111-111111111111',
    event: 'incident_opened',
    monitorName: 'Checkout API',
    monitorUrl: 'https://shop.example.com/health',
    occurredAt: new Date('2026-10-07T12:00:00.000Z'),
    ...overrides,
  };
}

interface Received {
  method: string | undefined;
  contentType: string | undefined;
  body: string;
}

interface Receiver {
  url: string;
  received: Received[];
  close: () => Promise<void>;
}

async function startReceiver(
  respond: (res: http.ServerResponse) => void = (res) => {
    res.writeHead(204);
    res.end();
  },
): Promise<Receiver> {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({ method: req.method, contentType: req.headers['content-type'], body });
      respond(res);
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

async function signup(email: string, organizationName: string) {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email, password: 'password123', organizationName });
  return {
    token: res.body.data.accessToken as string,
    orgId: res.body.data.user.organizationId as string,
  };
}

/** Opens a real incident (FK target for delivery rows) before any channel exists, so only the manual dispatch delivers. */
async function openIncident(token: string): Promise<string> {
  const created = await request(app)
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
  const monitorId = created.body.data.monitor.id as string;
  await recordCheckResult(monitorId, FAIL);
  await recordCheckResult(monitorId, FAIL);
  const incident = await pool.query<{ id: string }>(
    `SELECT id FROM incidents WHERE monitor_id = $1`,
    [monitorId],
  );
  return incident.rows[0]!.id;
}

describe('chat webhook URL validation', () => {
  it.each([
    ['discord', DISCORD_URL],
    ['discord', 'https://discordapp.com/api/webhooks/1/abc'],
    ['discord', 'https://ptb.discord.com/api/v10/webhooks/1/abc'],
    ['slack', SLACK_URL],
  ] as const)('accepts a real %s URL', (type, url) => {
    expect(isChatWebhookUrl(type, url)).toBe(true);
  });

  it.each([
    ['plain http', 'discord', 'http://discord.com/api/webhooks/1/abc'],
    ['lookalike host', 'discord', 'https://discord.com.evil.test/api/webhooks/1/abc'],
    ['unrelated host', 'discord', 'https://evil.test/api/webhooks/1/abc'],
    ['userinfo host trick', 'discord', 'https://discord.com@evil.test/api/webhooks/1/abc'],
    ['credentials in URL', 'discord', 'https://user:pw@discord.com/api/webhooks/1/abc'],
    ['query string', 'discord', 'https://discord.com/api/webhooks/1/abc?wait=true'],
    ['explicit port', 'discord', 'https://discord.com:8443/api/webhooks/1/abc'],
    ['non-numeric id', 'discord', 'https://discord.com/api/webhooks/abc/token'],
    ['internal address', 'discord', 'https://127.0.0.1/api/webhooks/1/abc'],
    ['railway internal host', 'discord', 'https://postgres.railway.internal/api/webhooks/1/abc'],
    ['slack URL as discord', 'discord', SLACK_URL],
    ['discord URL as slack', 'slack', DISCORD_URL],
    ['slack missing token', 'slack', 'https://hooks.slack.com/services/T1/B1'],
    ['slack wrong host', 'slack', 'https://slack.com/services/T1/B2/abc'],
    ['not a URL', 'slack', 'not a url'],
  ] as const)('rejects %s', (_label, type, url) => {
    expect(isChatWebhookUrl(type, url)).toBe(false);
  });
});

describe('masking', () => {
  it('keeps the identifiers and hides the token', () => {
    expect(maskChatWebhookUrl('discord', DISCORD_URL)).toBe(
      'discord.com/api/webhooks/123456789012345678/••••••••',
    );
    expect(maskChatWebhookUrl('slack', SLACK_URL)).toBe(
      'hooks.slack.com/services/T00000000/B00000000/••••••••',
    );
    expect(maskChatWebhookUrl('discord', DISCORD_URL)).not.toContain('SECRETtoken');
    expect(maskChatWebhookUrl('slack', SLACK_URL)).not.toContain('SECRETtoken');
  });

  it('refuses to mask something that is not a valid URL', () => {
    expect(() => maskChatWebhookUrl('discord', 'https://evil.test/x')).toThrow();
  });
});

describe('payloads', () => {
  it('builds a Discord embed that cannot ping anyone', () => {
    const payload = buildDiscordPayload(context({ monitorName: '@everyone' }));
    // A user-controlled monitor name must never trigger a mention.
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.embeds[0]!.title).toBe('🔴 @everyone is DOWN');
    expect(payload.embeds[0]!.color).toBe(0xe5484d);
    expect(payload.embeds[0]!.fields).toEqual([
      { name: 'URL', value: 'https://shop.example.com/health' },
      { name: 'Incident', value: '11111111-1111-1111-1111-111111111111' },
    ]);
    expect(payload.embeds[0]!.timestamp).toBe('2026-10-07T12:00:00.000Z');
  });

  it('uses green and recovery wording when an incident resolves', () => {
    const payload = buildDiscordPayload(context({ event: 'incident_resolved' }));
    expect(payload.embeds[0]!.title).toBe('🟢 Checkout API has RECOVERED');
    expect(payload.embeds[0]!.color).toBe(0x30a46c);
  });

  it('keeps long names within Discord limits', () => {
    const payload = buildDiscordPayload(context({ monitorName: 'x'.repeat(500) }));
    expect(payload.embeds[0]!.title.length).toBeLessThanOrEqual(256);
  });

  it('escapes Slack control characters in user-controlled text', () => {
    const payload = buildSlackPayload(context({ monitorName: '<!channel> a & b' }));
    expect(payload.text).toBe('🔴 &lt;!channel&gt; a &amp; b is DOWN');
    expect(payload.text).not.toContain('<!channel>');
  });

  it('cannot break out of a Slack link through the monitor URL', () => {
    const payload = buildSlackPayload(context({ monitorUrl: 'https://x.test/a|b>c<d' }));
    const field = payload.attachments[0]!.blocks[0]!.fields![0]!.text;
    expect(field).toContain('<https://x.test/a%7Cb%3Ec%3Cd|');
  });

  it('builds a recovery message for Slack', () => {
    const payload = buildSlackPayload(context({ event: 'incident_resolved' }));
    expect(payload.text).toBe('🟢 Checkout API has RECOVERED');
    expect(payload.attachments[0]!.color).toBe('#30a46c');
  });
});

describe('sendAlertChat', () => {
  it('POSTs the Discord body as JSON and reports success on 204', async () => {
    const receiver = await startReceiver();
    try {
      const outcome = await sendAlertChat('discord', receiver.url, context());
      expect(outcome).toMatchObject({ status: 'sent', responseCode: 204, error: null });
      expect(receiver.received).toHaveLength(1);
      expect(receiver.received[0]).toMatchObject({
        method: 'POST',
        contentType: 'application/json',
      });
      const body = JSON.parse(receiver.received[0]!.body);
      expect(body.embeds[0].title).toBe('🔴 Checkout API is DOWN');
      expect(body.allowed_mentions).toEqual({ parse: [] });
    } finally {
      await receiver.close();
    }
  });

  it('POSTs the Slack body and reports success on 200', async () => {
    const receiver = await startReceiver((res) => {
      res.writeHead(200);
      res.end('ok');
    });
    try {
      const outcome = await sendAlertChat('slack', receiver.url, context());
      expect(outcome).toMatchObject({ status: 'sent', responseCode: 200 });
      const body = JSON.parse(receiver.received[0]!.body);
      expect(body.text).toBe('🔴 Checkout API is DOWN');
      expect(body.attachments).toHaveLength(1);
    } finally {
      await receiver.close();
    }
  });

  it("records the service's own reason when it rejects the request", async () => {
    const receiver = await startReceiver((res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"message": "Unknown Webhook", "code": 10015}');
    });
    try {
      const outcome = await sendAlertChat('discord', receiver.url, context());
      expect(outcome.status).toBe('failed');
      expect(outcome.responseCode).toBe(404);
      expect(outcome.error).toContain('Received HTTP 404');
      expect(outcome.error).toContain('Unknown Webhook');
    } finally {
      await receiver.close();
    }
  });

  it('never puts the webhook URL in the error when the service is unreachable', async () => {
    const closed = await startReceiver();
    const url = closed.url;
    await closed.close();

    const outcome = await sendAlertChat('slack', url, context());
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toBe('Could not reach Slack');
    expect(outcome.error).not.toContain('127.0.0.1');
  });

  it('does not follow a redirect', async () => {
    const elsewhere = await startReceiver();
    const redirecting = await startReceiver((res) => {
      res.writeHead(302, { Location: elsewhere.url });
      res.end();
    });
    try {
      const outcome = await sendAlertChat('discord', redirecting.url, context());
      expect(outcome.status).toBe('failed');
      expect(elsewhere.received).toHaveLength(0);
    } finally {
      await redirecting.close();
      await elsewhere.close();
    }
  });
});

describe('chat channels through the API', () => {
  it.each([
    ['discord', DISCORD_URL, 'discord.com/api/webhooks/123456789012345678/••••••••'],
    ['slack', SLACK_URL, 'hooks.slack.com/services/T00000000/B00000000/••••••••'],
  ] as const)(
    'stores a %s URL encrypted and only ever returns the masked label',
    async (type, url, masked) => {
      const { token, orgId } = await signup(`${type}@example.com`, `${type} org`);

      const created = await request(app)
        .post('/api/v1/alerts/channels')
        .set('Authorization', `Bearer ${token}`)
        .send({ type, target: url });

      expect(created.status).toBe(201);
      expect(created.body.data.channel).toMatchObject({ type, target: masked, enabled: true });
      // No signing secret is revealed for chat channels, and the pasted URL is not echoed.
      expect(created.body.data.secret).toBeUndefined();
      expect(JSON.stringify(created.body)).not.toContain('SECRETtoken');

      const listed = await request(app)
        .get('/api/v1/alerts/channels')
        .set('Authorization', `Bearer ${token}`);
      expect(listed.body.data.channels[0]).toMatchObject({ type, target: masked });
      expect(JSON.stringify(listed.body)).not.toContain('SECRETtoken');

      const row = await pool.query<{ target: string; secret_encrypted: string }>(
        `SELECT target, secret_encrypted FROM notification_channels WHERE organization_id = $1`,
        [orgId],
      );
      expect(row.rows[0]!.target).toBe(masked);
      expect(row.rows[0]!.secret_encrypted).not.toContain('SECRETtoken');
      expect(decryptSecret(row.rows[0]!.secret_encrypted)).toBe(url);
    },
  );

  it.each([
    ['discord', 'https://evil.test/api/webhooks/1/abc'],
    ['discord', 'https://discord.com.evil.test/api/webhooks/1/abc'],
    ['discord', 'http://discord.com/api/webhooks/1/abc'],
    ['slack', 'https://hooks.slack.com.evil.test/services/T1/B2/abc'],
    ['slack', DISCORD_URL],
  ] as const)('rejects a %s channel pointing at %s', async (type, target) => {
    const { token } = await signup('bad@example.com', 'bad org');
    const res = await request(app)
      .post('/api/v1/alerts/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({ type, target });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');

    const count = await pool.query(`SELECT 1 FROM notification_channels`);
    expect(count.rowCount).toBe(0);
  });

  it('still never allows an email channel to carry a secret', async () => {
    const { orgId } = await signup('e@example.com', 'email org');
    await expect(
      pool.query(
        `INSERT INTO notification_channels (organization_id, type, target, secret_encrypted)
         VALUES ($1, 'email', 'a@example.com', 'x')`,
        [orgId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('chat channels through alert dispatch', () => {
  async function insertChatChannel(
    orgId: string,
    type: 'discord' | 'slack',
    target: string,
    secretEncrypted: string | null,
  ) {
    await pool.query(
      `INSERT INTO notification_channels (organization_id, type, target, secret_encrypted)
       VALUES ($1, $2, $3, $4)`,
      [orgId, type, target, secretEncrypted],
    );
  }

  it.each([
    ['discord', 'discord.com/api/webhooks/123/••••••••'],
    ['slack', 'hooks.slack.com/services/T0/B0/••••••••'],
  ] as const)('delivers to %s and logs the masked target, not the URL', async (type, masked) => {
    const receiver = await startReceiver((res) => {
      res.writeHead(200);
      res.end('ok');
    });
    try {
      const { token, orgId } = await signup(`d-${type}@example.com`, `${type} dispatch`);
      const incidentId = await openIncident(token);
      await insertChatChannel(orgId, type, masked, encryptSecret(receiver.url));

      await dispatchAlerts(context({ organizationId: orgId, incidentId, monitorName: 'Target' }));

      expect(receiver.received).toHaveLength(1);
      const log = await pool.query<{
        channel: string;
        status: string;
        target: string;
        response_code: number;
      }>(`SELECT channel, status, target, response_code FROM alert_deliveries`);
      expect(log.rows).toEqual([
        { channel: type, status: 'sent', target: masked, response_code: 200 },
      ]);
      expect(log.rows[0]!.target).not.toContain('127.0.0.1');
    } finally {
      await receiver.close();
    }
  });

  it('logs a failed delivery, without leaking the URL, when the service rejects it', async () => {
    const receiver = await startReceiver((res) => {
      res.writeHead(404);
      res.end('Unknown Webhook');
    });
    try {
      const { token, orgId } = await signup('rej@example.com', 'rejecting org');
      const incidentId = await openIncident(token);
      await insertChatChannel(
        orgId,
        'discord',
        'discord.com/api/webhooks/1/••••••••',
        encryptSecret(receiver.url),
      );

      await dispatchAlerts(context({ organizationId: orgId, incidentId }));

      const log = await pool.query<{ status: string; error: string }>(
        `SELECT status, error FROM alert_deliveries`,
      );
      expect(log.rows[0]!.status).toBe('failed');
      expect(log.rows[0]!.error).toContain('404');
      expect(log.rows[0]!.error).not.toContain('127.0.0.1');
    } finally {
      await receiver.close();
    }
  });

  it('isolates a chat channel with an unusable or missing URL from the others', async () => {
    const receiver = await startReceiver();
    try {
      const { token, orgId } = await signup('iso@example.com', 'isolation org');
      const incidentId = await openIncident(token);
      await insertChatChannel(
        orgId,
        'discord',
        'discord.com/api/webhooks/1/••••••••',
        'not-decryptable',
      );
      await insertChatChannel(orgId, 'slack', 'hooks.slack.com/services/T0/B0/••••••••', null);
      await insertChatChannel(
        orgId,
        'discord',
        'discord.com/api/webhooks/2/••••••••',
        encryptSecret(receiver.url),
      );

      await dispatchAlerts(context({ organizationId: orgId, incidentId }));

      // The healthy channel delivered despite two broken siblings.
      expect(receiver.received).toHaveLength(1);
      const log = await pool.query<{ status: string; error: string | null }>(
        `SELECT status, error FROM alert_deliveries ORDER BY status DESC, target`,
      );
      expect(log.rows).toHaveLength(3);
      expect(log.rows.filter((r) => r.status === 'sent')).toHaveLength(1);
      const failures = log.rows.filter((r) => r.status === 'failed');
      expect(failures).toHaveLength(2);
      expect(failures.map((f) => f.error).join(' ')).toContain(
        'Slack channel has no stored webhook URL',
      );
    } finally {
      await receiver.close();
    }
  });
});
