import { pool } from '../../db/pool.js';
import { AppError } from '../../shared/errors/AppError.js';
import type { MonitorStatus } from '../checker/checker.state-machine.js';

/** What the public sees. Deliberately coarser than the internal state machine. */
export type PublicStatus = 'operational' | 'degraded' | 'down' | 'unknown';

export type OverallStatus = 'operational' | 'degraded' | 'major_outage' | 'unknown';

export interface PublicMonitor {
  name: string;
  status: PublicStatus;
  uptime24h: number | null;
  lastCheckedAt: Date | null;
}

export interface PublicIncident {
  title: string;
  monitorName: string | null;
  startedAt: Date;
  resolvedAt: Date | null;
}

export interface StatusPage {
  organization: { name: string; slug: string };
  overallStatus: OverallStatus;
  monitors: PublicMonitor[];
  incidents: PublicIncident[];
  updatedAt: Date;
}

const INCIDENT_HISTORY_DAYS = 14;

/**
 * The internal state machine has five states, but suspected_down/suspected_up are
 * bookkeeping for streaks in progress -- publishing them would tell the public a monitor
 * is "suspected down" before SitePulse itself has decided that. They collapse to degraded:
 * something is off, not yet confirmed as an outage.
 */
function toPublicStatus(status: MonitorStatus): PublicStatus {
  switch (status) {
    case 'up':
      return 'operational';
    case 'down':
      return 'down';
    case 'suspected_down':
    case 'suspected_up':
      return 'degraded';
    case 'pending':
      return 'unknown';
  }
}

function toOverallStatus(monitors: PublicMonitor[]): OverallStatus {
  if (monitors.length === 0) return 'unknown';
  if (monitors.some((m) => m.status === 'down')) {
    // Everything down reads as a major outage; a subset down is degraded service.
    return monitors.every((m) => m.status === 'down') ? 'major_outage' : 'degraded';
  }
  if (monitors.some((m) => m.status === 'degraded')) return 'degraded';
  if (monitors.every((m) => m.status === 'unknown')) return 'unknown';
  return 'operational';
}

interface MonitorRow {
  name: string;
  status: MonitorStatus;
  last_checked_at: Date | null;
  uptime_24h: string | null;
}

interface IncidentRow {
  title: string;
  monitor_name: string | null;
  started_at: Date;
  resolved_at: Date | null;
}

export async function getStatusPageBySlug(slug: string): Promise<StatusPage> {
  const orgResult = await pool.query<{ id: string; name: string; slug: string }>(
    `SELECT id, name, slug FROM organizations WHERE slug = $1`,
    [slug],
  );
  const organization = orgResult.rows[0];
  if (!organization) {
    throw new AppError(404, 'STATUS_PAGE_NOT_FOUND', 'Status page not found');
  }

  // Uptime is computed in one pass with a lateral join rather than a query per monitor --
  // this endpoint is public and uncached, so it's the one most exposed to traffic.
  // The (monitor_id, checked_at) index plus partition pruning on the 24h window keeps it
  // off a full scan of check history.
  const monitorsResult = await pool.query<MonitorRow>(
    `SELECT m.name,
            m.status,
            m.last_checked_at,
            stats.uptime_24h
     FROM monitors m
     LEFT JOIN LATERAL (
       SELECT CASE WHEN count(*) = 0 THEN NULL
                   ELSE round(100.0 * count(*) FILTER (WHERE c.success) / count(*), 2)
              END AS uptime_24h
       FROM checks c
       WHERE c.monitor_id = m.id AND c.checked_at >= now() - interval '24 hours'
     ) stats ON true
     WHERE m.organization_id = $1
     ORDER BY m.name`,
    [organization.id],
  );

  const monitors: PublicMonitor[] = monitorsResult.rows.map((row) => ({
    name: row.name,
    status: toPublicStatus(row.status),
    uptime24h: row.uptime_24h === null ? null : Number(row.uptime_24h),
    lastCheckedAt: row.last_checked_at,
  }));

  const incidentsResult = await pool.query<IncidentRow>(
    `SELECT i.title, m.name AS monitor_name, i.started_at, i.resolved_at
     FROM incidents i
     LEFT JOIN monitors m ON m.id = i.monitor_id
     WHERE i.organization_id = $1
       AND i.started_at >= now() - ($2 || ' days')::interval
     ORDER BY i.started_at DESC
     LIMIT 50`,
    [organization.id, INCIDENT_HISTORY_DAYS],
  );

  return {
    organization: { name: organization.name, slug: organization.slug },
    overallStatus: toOverallStatus(monitors),
    monitors,
    incidents: incidentsResult.rows.map((row) => ({
      title: row.title,
      monitorName: row.monitor_name,
      startedAt: row.started_at,
      resolvedAt: row.resolved_at,
    })),
    updatedAt: new Date(),
  };
}
