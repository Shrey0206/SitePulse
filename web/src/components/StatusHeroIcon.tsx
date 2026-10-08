import type { OverallStatus } from '../lib/types';

/** Each status has its own glyph, so the hero is never distinguished by colour alone. */
const GLYPH: Record<OverallStatus, React.ReactNode> = {
  operational: <path d="m8 12.5 2.8 2.8L16 9.5" />,
  degraded: <path d="M12 7.5v5.5M12 16.5h.01" />,
  major_outage: <path d="m9 9 6 6m0-6-6 6" />,
  unknown: <path d="M8.5 12h7" />,
};

export function StatusHeroIcon({ status }: { status: OverallStatus }) {
  return (
    <svg
      className="status-hero__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      {GLYPH[status]}
    </svg>
  );
}
