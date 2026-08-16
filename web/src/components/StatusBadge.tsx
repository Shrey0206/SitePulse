import type { MonitorStatus, PublicStatus } from '../lib/types';

type Tone = 'up' | 'down' | 'degraded' | 'unknown';

const MONITOR_LABELS: Record<MonitorStatus, { label: string; tone: Tone }> = {
  up: { label: 'Up', tone: 'up' },
  down: { label: 'Down', tone: 'down' },
  // Named for what they mean operationally rather than by their internal state name.
  suspected_down: { label: 'Failing checks', tone: 'degraded' },
  suspected_up: { label: 'Recovering', tone: 'degraded' },
  pending: { label: 'Not yet checked', tone: 'unknown' },
};

const PUBLIC_LABELS: Record<PublicStatus, { label: string; tone: Tone }> = {
  operational: { label: 'Operational', tone: 'up' },
  down: { label: 'Down', tone: 'down' },
  degraded: { label: 'Degraded', tone: 'degraded' },
  unknown: { label: 'Unknown', tone: 'unknown' },
};

/**
 * Status is never communicated by colour alone (UI_DESIGN.md §5): the badge always carries
 * a text label, so it stays readable to colourblind users and in monochrome.
 */
export function StatusBadge({ status }: { status: MonitorStatus | PublicStatus }) {
  const entry =
    status in MONITOR_LABELS
      ? MONITOR_LABELS[status as MonitorStatus]
      : PUBLIC_LABELS[status as PublicStatus];

  return (
    <span className={`status-badge status-badge--${entry.tone}`}>
      <span className="status-badge__dot" aria-hidden="true" />
      {entry.label}
    </span>
  );
}
