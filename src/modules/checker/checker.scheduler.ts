import { performHttpCheck } from './checker.http.js';
import { ensureChecksPartitions } from './checker.partitions.js';
import { type DueMonitor, getDueMonitors, recordCheckResult } from './checker.service.js';

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
    await recordCheckResult(monitor.id, result);
  } catch (err) {
    console.error(`Check failed for monitor ${monitor.id}:`, err);
  } finally {
    inFlight.delete(monitor.id);
  }
}

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
  } catch (err) {
    console.error('Scheduler tick failed:', err);
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
