import { useLive } from '../state/hooks';

/**
 * Surfaces SSE connection state persistently rather than hiding it (UI_TECH_DECISIONS.md
 * #4). A monitoring dashboard silently showing stale data is worse than one admitting it's
 * disconnected -- the user would have no way to tell "everything is fine" from "nothing is
 * updating".
 *
 * Deliberately a thin banner, not a blocking error: the page's last-fetched data is still
 * useful while reconnecting.
 */
export function ConnectionBanner() {
  const live = useLive();
  if (!live || live.connection === 'open') return null;

  const connecting = live.connection === 'connecting';

  return (
    <div className={`banner ${connecting ? 'banner--info' : 'banner--warning'}`} role="status">
      <span aria-hidden="true">{connecting ? '○' : '◍'}</span>
      {connecting ? 'Connecting to live updates…' : 'Live updates paused — reconnecting…'}
    </div>
  );
}
