import { dispatchAlerts } from '../alerts/alerts.service.js';
import { broadcastToOrg } from '../sse/sse.hub.js';
import { performHttpCheck } from './checker.http.js';
import { ensureChecksPartitions } from './checker.partitions.js';
import { type DueMonitor, type RecordedCheck, getDueMonitors, recordCheckResult } from './checker.service.js';

const TICK_INTERVAL_MS = 5000;
const PARTITION_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const inFlight = new Set<string>();

let lastCycleCompletedAt: Date | null = null;
let tickTimer: NodeJS.Timeout | null = null;
let partitionTimer: NodeJS.Timeout | null = null;

export function getLastCycleCompletedAt(): Date | null {
  return lastCycleCompletedAt;
}

async function runCheck(monitor: DueMonitor): Promise<void> {
  inFlight.add(monitor.id);
  try {
    const result = await performHttpCheck(monitor);
    const recorded = await recordCheckResult(monitor.id, result);

    publishToDashboards(monitor, recorded);

    // Dispatched after the transaction commits, deliberately. Sending inside it would
    // mean a later rollback leaves an alert already delivered for an incident that no
    // longer exists -- and network I/O would hold a row lock open for its full duration.
    await dispatchIncidentAlerts(monitor, recorded.incident);
  } catch (err) {
    console.error(`Check failed for monitor ${monitor.id}:`, err);
  } finally {
    inFlight.delete(monitor.id);
  }
}

/**
 * Pushes live dashboard updates. Unlike alerting, this fires on every status change --
 * including the suspected_* states -- because a dashboard showing "something looks wrong
 * right now" is useful, whereas an email saying it is not (DECISIONS.md #8 vs #7).
 *
 * Synchronous and non-throwing: broadcasting is a best-effort write to already-open
 * sockets, and must never fail the check that produced it.
 */
function publishToDashboards(monitor: DueMonitor, recorded: RecordedCheck): void {
  if (recorded.statusChanged) {
    broadcastToOrg(monitor.organizationId, {
      type: 'monitor_status_changed',
      data: {
        monitorId: monitor.id,
        name: monitor.name,
        previousStatus: recorded.previousStatus,
        status: recorded.status,
        at: new Date().toISOString(),
      },
    });
  }

  if (recorded.incident.opened) {
    broadcastToOrg(monitor.organizationId, {
      type: 'incident_opened',
      data: { incidentId: recorded.incident.opened.id, monitorId: monitor.id, name: monitor.name },
    });
  }

  if (recorded.incident.resolved) {
    broadcastToOrg(monitor.organizationId, {
      type: 'incident_resolved',
      data: { incidentId: recorded.incident.resolved.id, monitorId: monitor.id, name: monitor.name },
    });
  }
}

async function dispatchIncidentAlerts(monitor: DueMonitor, incident: RecordedCheck['incident']): Promise<void> {
  const transition = incident.opened
    ? { incidentId: incident.opened.id, event: 'incident_opened' as const }
    : incident.resolved
      ? { incidentId: incident.resolved.id, event: 'incident_resolved' as const }
      : null;

  // Only the open and resolve edges alert -- never one per failing check (DECISIONS.md #8).
  if (!transition) return;

  await dispatchAlerts({
    organizationId: monitor.organizationId,
    incidentId: transition.incidentId,
    event: transition.event,
    monitorName: monitor.name,
    monitorUrl: monitor.url,
    occurredAt: new Date(),
  });
}

// A tick runs every 5s, so an outage that lasts minutes would otherwise emit hundreds of
// identical stack dumps and bury everything else in the log -- including whatever is
// needed to diagnose the outage. Collapse consecutive identical failures into a count.
let consecutiveTickFailures = 0;
let lastTickErrorMessage: string | null = null;

async function tick(): Promise<void> {
  try {
    const due = await getDueMonitors();

    const toRun = due.filter((m) => !inFlight.has(m.id));
    const skipped = due.filter((m) => inFlight.has(m.id));
    for (const monitor of skipped) {
      // A monitor's previous check outlived its own interval. Skipping (rather than
      // overlapping or queueing) keeps "checks for a given monitor never run concurrently
      // with themselves" true, which the state machine relies on (DECISIONS.md #20).
      console.warn(`Skipping monitor ${monitor.id}: previous check still in-flight`);
    }

    await Promise.all(toRun.map(runCheck));
    lastCycleCompletedAt = new Date();

    if (consecutiveTickFailures > 0) {
      console.info(`Scheduler recovered after ${consecutiveTickFailures} failed tick(s)`);
      consecutiveTickFailures = 0;
      lastTickErrorMessage = null;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    consecutiveTickFailures += 1;

    // Full detail on the first occurrence, then a periodic one-line reminder. /health is
    // the intended signal that the checker is stuck (DECISIONS.md #13); the log only needs
    // to say why, once.
    if (message !== lastTickErrorMessage) {
      console.error('Scheduler tick failed:', err);
      lastTickErrorMessage = message;
    } else if (consecutiveTickFailures % 60 === 0) {
      console.error(`Scheduler tick still failing (${consecutiveTickFailures} consecutive): ${message}`);
    }
  }
}

// Never rejects -- callers fire this without awaiting it (the HTTP server shouldn't wait
// on the first check cycle to start listening), so a rejection here would otherwise become
// an unhandled rejection instead of a logged, recoverable error.
export async function startScheduler(): Promise<void> {
  try {
    await ensureChecksPartitions();
  } catch (err) {
    console.error('Initial partition maintenance failed:', err);
  }
  partitionTimer = setInterval(() => {
    ensureChecksPartitions().catch((err: unknown) => console.error('Partition maintenance failed:', err));
  }, PARTITION_MAINTENANCE_INTERVAL_MS);

  await tick();
  tickTimer = setInterval(() => {
    tick().catch((err: unknown) => console.error('Scheduler tick failed:', err));
  }, TICK_INTERVAL_MS);
}

export function stopScheduler(): void {
  if (tickTimer) clearInterval(tickTimer);
  if (partitionTimer) clearInterval(partitionTimer);
  tickTimer = null;
  partitionTimer = null;
}
