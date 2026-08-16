import type { PoolClient } from 'pg';
import { isUniqueViolation } from '../../shared/utils/db-errors.js';
import type { MonitorStatus } from '../checker/checker.state-machine.js';

export interface IncidentTransition {
  opened: { id: string } | null;
  resolved: { id: string } | null;
}

const NO_TRANSITION: IncidentTransition = { opened: null, resolved: null };

/**
 * Enforces the standing invariant from DECISIONS.md #28:
 *   status 'down' => exactly one open auto incident exists for the monitor
 *   status 'up'   => no open auto incident remains
 *
 * Deliberately evaluated on every check write rather than only on the transition edge.
 * Edge-triggered creation breaks as soon as anything moves the incident out of band --
 * a user manually resolving an incident while the monitor is still down would leave the
 * status page claiming "operational" forever, because no further transition ever occurs
 * to re-open it. Re-asserting the invariant makes the system self-correct instead.
 *
 * Intermediate states (suspected_down / suspected_up) intentionally do nothing: an
 * incident opens only on a confirmed outage and closes only on a confirmed recovery.
 *
 * Runs inside the caller's transaction so the incident and the check that triggered it
 * commit together.
 */
export async function enforceAutoIncidentInvariant(
  client: PoolClient,
  monitor: { id: string; organizationId: string; name: string },
  status: MonitorStatus,
): Promise<IncidentTransition> {
  if (status === 'down') {
    try {
      const result = await client.query<{ id: string }>(
        `INSERT INTO incidents (organization_id, monitor_id, source, title)
         SELECT $1, $2, 'auto', $3
         WHERE NOT EXISTS (
           SELECT 1 FROM incidents
           WHERE monitor_id = $2 AND source = 'auto' AND resolved_at IS NULL
         )
         RETURNING id`,
        [monitor.organizationId, monitor.id, `${monitor.name} is down`],
      );
      const opened = result.rows[0];
      return opened ? { opened, resolved: null } : NO_TRANSITION;
    } catch (err) {
      // The partial unique index caught a concurrent writer between our NOT EXISTS check
      // and the insert. The invariant still holds -- an open incident exists, which is
      // all this function promises -- so treat it as a no-op rather than failing the
      // check write that triggered it.
      if (isUniqueViolation(err, 'incidents_one_open_auto_per_monitor_idx')) return NO_TRANSITION;
      throw err;
    }
  }

  if (status === 'up') {
    const result = await client.query<{ id: string }>(
      `UPDATE incidents SET resolved_at = now()
       WHERE monitor_id = $1 AND source = 'auto' AND resolved_at IS NULL
       RETURNING id`,
      [monitor.id],
    );
    const resolved = result.rows[0];
    return resolved ? { opened: null, resolved } : NO_TRANSITION;
  }

  return NO_TRANSITION;
}
