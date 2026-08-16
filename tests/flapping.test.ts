import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import * as emailModule from '../src/modules/alerts/alerts.email.js';
import { dispatchAlerts } from '../src/modules/alerts/alerts.service.js';
import type { CheckResult } from '../src/modules/checker/checker.http.js';
import { type RecordedCheck, recordCheckResult } from '../src/modules/checker/checker.service.js';
import { closeDb, resetDb } from './helpers/db.js';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());
afterAll(closeDb);

const OK: CheckResult = { success: true, statusCode: 200, responseTimeMs: 5, error: null };
const FAIL: CheckResult = { success: false, statusCode: 500, responseTimeMs: 5, error: null };

async function signup(email: string, organizationName: string) {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ email, password: 'password123', organizationName });
  return { token: res.body.data.accessToken as string, orgId: res.body.data.user.organizationId as string };
}

async function createMonitor(token: string, thresholds = { failure: 3, recovery: 3 }): Promise<string> {
  const res = await request(app)
    .post('/api/v1/monitors')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Target',
      url: 'https://example.com',
      intervalSeconds: 60,
      timeoutSeconds: 10,
      failureThreshold: thresholds.failure,
      recoveryThreshold: thresholds.recovery,
    });
  return res.body.data.monitor.id as string;
}

/**
 * Mirrors what the scheduler does per check: record the result, then alert only on an
 * incident edge. Lets a whole outage narrative run as one call while still exercising the
 * real transaction and the real dispatch path.
 */
async function runChecks(
  orgId: string,
  monitorId: string,
  results: CheckResult[],
): Promise<RecordedCheck[]> {
  const recorded: RecordedCheck[] = [];
  for (const result of results) {
    const outcome = await recordCheckResult(monitorId, result);
    recorded.push(outcome);

    const edge = outcome.incident.opened
      ? { id: outcome.incident.opened.id, event: 'incident_opened' as const }
      : outcome.incident.resolved
        ? { id: outcome.incident.resolved.id, event: 'incident_resolved' as const }
        : null;

    if (edge) {
      await dispatchAlerts({
        organizationId: orgId,
        incidentId: edge.id,
        event: edge.event,
        monitorName: 'Target',
        monitorUrl: 'https://example.com',
        occurredAt: new Date(),
      });
    }
  }
  return recorded;
}

function stubEmail() {
  return vi.spyOn(emailModule, 'sendAlertEmail').mockResolvedValue({
    status: 'sent',
    responseCode: null,
    latencyMs: 1,
    error: null,
  });
}

async function setup(email: string, org: string, thresholds?: { failure: number; recovery: number }) {
  const send = stubEmail();
  const { token, orgId } = await signup(email, org);
  await request(app)
    .post('/api/v1/alerts/channels')
    .set('Authorization', `Bearer ${token}`)
    .send({ type: 'email', target: 'oncall@example.com' });
  const monitorId = await createMonitor(token, thresholds);
  return { send, token, orgId, monitorId };
}

async function monitorStatus(monitorId: string): Promise<string> {
  const res = await pool.query<{ status: string }>(`SELECT status FROM monitors WHERE id = $1`, [monitorId]);
  return res.rows[0]!.status;
}

describe('flapping protection', () => {
  // The headline claim: transient blips must not page anyone.
  it('sends no alert for isolated failures that never reach the threshold', async () => {
    const { send, orgId, monitorId } = await setup('f1@example.com', 'FOrg1');

    await runChecks(orgId, monitorId, [OK, FAIL, OK, FAIL, OK, FAIL, OK]);

    expect(send).not.toHaveBeenCalled();
    expect(await monitorStatus(monitorId)).toBe('up');
    const incidents = await pool.query(`SELECT 1 FROM incidents`);
    expect(incidents.rowCount).toBe(0);
  });

  it('sends exactly one alert for a sustained outage, however long it lasts', async () => {
    const { send, orgId, monitorId } = await setup('f2@example.com', 'FOrg2');

    await runChecks(orgId, monitorId, Array<CheckResult>(12).fill(FAIL));

    expect(send).toHaveBeenCalledTimes(1);
    const deliveries = await pool.query(`SELECT 1 FROM alert_deliveries`);
    expect(deliveries.rowCount).toBe(1);
  });

  it('sends one alert per full down/up cycle, not per status change', async () => {
    const { send, orgId, monitorId } = await setup('f3@example.com', 'FOrg3');

    // Two complete outages separated by a full recovery.
    await runChecks(orgId, monitorId, [
      ...Array<CheckResult>(3).fill(FAIL),
      ...Array<CheckResult>(3).fill(OK),
      ...Array<CheckResult>(3).fill(FAIL),
      ...Array<CheckResult>(3).fill(OK),
    ]);

    // 2 opens + 2 resolves.
    expect(send).toHaveBeenCalledTimes(4);
    const events = await pool.query<{ event: string }>(
      `SELECT event FROM alert_deliveries ORDER BY created_at`,
    );
    expect(events.rows.map((r) => r.event)).toEqual([
      'incident_opened',
      'incident_resolved',
      'incident_opened',
      'incident_resolved',
    ]);
  });

  // DECISIONS.md #8 states this limitation explicitly rather than hiding it: a monitor
  // flapping through complete cycles alerts once per cycle. This test pins that stated
  // behaviour so it stays a known trade-off rather than drifting silently.
  it('alerts once per cycle when a monitor flaps through complete cycles (known v1 limitation)', async () => {
    const { send, orgId, monitorId } = await setup('f4@example.com', 'FOrg4', { failure: 1, recovery: 1 });

    await runChecks(orgId, monitorId, [FAIL, OK, FAIL, OK, FAIL, OK]);

    // 3 opens + 3 resolves. A cooldown/suppression layer is named as v1.1 scope in #8.
    expect(send).toHaveBeenCalledTimes(6);
  });

  it('does not resolve an incident on a single success mid-outage', async () => {
    const { send, orgId, monitorId } = await setup('f5@example.com', 'FOrg5');

    await runChecks(orgId, monitorId, [FAIL, FAIL, FAIL, OK, FAIL, FAIL, FAIL]);

    // One open alert only -- the lone success reached suspected_up, never 'up'.
    expect(send).toHaveBeenCalledTimes(1);
    const open = await pool.query(`SELECT 1 FROM incidents WHERE resolved_at IS NULL`);
    expect(open.rowCount).toBe(1);
  });

  it('requires the full recovery streak before resolving', async () => {
    const { send, orgId, monitorId } = await setup('f6@example.com', 'FOrg6');

    await runChecks(orgId, monitorId, [FAIL, FAIL, FAIL, OK, OK]);
    expect(send).toHaveBeenCalledTimes(1); // still down, no resolve yet

    await runChecks(orgId, monitorId, [OK]);
    expect(send).toHaveBeenCalledTimes(2); // third success completes recovery
  });
});

describe('alert and incident consistency', () => {
  it('keeps monitor status, incident state and alert count in agreement across a full cycle', async () => {
    const { send, orgId, monitorId } = await setup('c1@example.com', 'COrg1', { failure: 2, recovery: 2 });

    await runChecks(orgId, monitorId, [FAIL, FAIL]);
    expect(await monitorStatus(monitorId)).toBe('down');
    expect((await pool.query(`SELECT 1 FROM incidents WHERE resolved_at IS NULL`)).rowCount).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);

    await runChecks(orgId, monitorId, [OK, OK]);
    expect(await monitorStatus(monitorId)).toBe('up');
    expect((await pool.query(`SELECT 1 FROM incidents WHERE resolved_at IS NULL`)).rowCount).toBe(0);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('re-alerts after a manual resolve leaves the monitor still down', async () => {
    const { send, token, orgId, monitorId } = await setup('c2@example.com', 'COrg2', {
      failure: 2,
      recovery: 2,
    });

    await runChecks(orgId, monitorId, [FAIL, FAIL]);
    expect(send).toHaveBeenCalledTimes(1);

    const incidentId = (
      await pool.query<{ id: string }>(`SELECT id FROM incidents WHERE monitor_id = $1`, [monitorId])
    ).rows[0]!.id;
    await request(app)
      .post(`/api/v1/incidents/${incidentId}/resolve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // The invariant reopens on the next check, and that new incident alerts on its own
    // edge -- the operator is told the outage is still happening rather than it going
    // silent after a premature manual resolve.
    await runChecks(orgId, monitorId, [FAIL]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not fire alerts for manual incidents', async () => {
    const send = stubEmail();
    const { token } = await signup('c3@example.com', 'COrg3');
    await request(app)
      .post('/api/v1/alerts/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'email', target: 'oncall@example.com' });

    await request(app)
      .post('/api/v1/incidents')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Planned maintenance' })
      .expect(201);

    // Manual incidents are declarative and stay silent (DECISIONS.md #36).
    expect(send).not.toHaveBeenCalled();
    expect((await pool.query(`SELECT 1 FROM alert_deliveries`)).rowCount).toBe(0);
  });

  it('records every check while alerting only on edges', async () => {
    const { send, orgId, monitorId } = await setup('c4@example.com', 'COrg4', { failure: 2, recovery: 2 });

    await runChecks(orgId, monitorId, Array<CheckResult>(8).fill(FAIL));

    const checks = await pool.query(`SELECT 1 FROM checks WHERE monitor_id = $1`, [monitorId]);
    expect(checks.rowCount).toBe(8);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('persists state machine counters so progress survives a restart', async () => {
    const { orgId, monitorId } = await setup('c5@example.com', 'COrg5', { failure: 3, recovery: 3 });

    await runChecks(orgId, monitorId, [FAIL, FAIL]);

    // Reading straight from the database is the point: nothing is held in process memory,
    // so a redeploy mid-streak resumes at 2-of-3 rather than restarting the count.
    const row = await pool.query<{ status: string; consecutive_failures: number }>(
      `SELECT status, consecutive_failures FROM monitors WHERE id = $1`,
      [monitorId],
    );
    expect(row.rows[0]).toMatchObject({ status: 'suspected_down', consecutive_failures: 2 });

    await runChecks(orgId, monitorId, [FAIL]);
    expect(await monitorStatus(monitorId)).toBe('down');
  });
});
