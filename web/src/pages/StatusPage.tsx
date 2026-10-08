import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { StatusBadge } from '../components/StatusBadge';
import { fetchPublic } from '../lib/api';
import { absoluteTime, duration, relativeTime } from '../lib/format';
import type { OverallStatus, StatusPage as StatusPageData } from '../lib/types';
import { useAsync } from '../lib/useAsync';

const OVERALL_COPY: Record<OverallStatus, { headline: string; detail: string }> = {
  operational: {
    headline: 'All systems operational',
    detail: 'Every monitored endpoint is responding normally.',
  },
  degraded: {
    headline: 'Degraded performance',
    detail: 'Some services are not responding as expected.',
  },
  major_outage: { headline: 'Major outage', detail: 'All monitored services are currently down.' },
  unknown: { headline: 'Status unavailable', detail: 'No monitoring data has been collected yet.' },
};

const REFRESH_MS = 30_000;

/** Each status has its own glyph, so the hero is never distinguished by colour alone. */
const HERO_ICON: Record<OverallStatus, React.ReactNode> = {
  operational: <path d="m8 12.5 2.8 2.8L16 9.5" />,
  degraded: <path d="M12 7.5v5.5M12 16.5h.01" />,
  major_outage: <path d="m9 9 6 6m0-6-6 6" />,
  unknown: <path d="M8.5 12h7" />,
};

function HeroIcon({ status }: { status: OverallStatus }) {
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
      {HERO_ICON[status]}
    </svg>
  );
}

function uptimeTone(uptime: number): 'success' | 'warning' | 'danger' {
  if (uptime >= 99) return 'success';
  if (uptime >= 95) return 'warning';
  return 'danger';
}

export function StatusPage() {
  const { slug } = useParams<{ slug: string }>();
  const [refreshedAt, setRefreshedAt] = useState(Date.now());

  const { data, loading, error, reload } = useAsync(
    useCallback(() => fetchPublic<StatusPageData>(`/status/${slug ?? ''}`), [slug]),
    [slug, refreshedAt],
  );

  // Polled rather than SSE: this page is public, and the SSE channel is authenticated and
  // org-scoped. A 30s poll against a 15s-cached endpoint is the honest fit here.
  useEffect(() => {
    const timer = window.setInterval(() => setRefreshedAt(Date.now()), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  // A browser tab for a customer-facing page should say whose status it is.
  const organizationName = data?.organization.name;
  useEffect(() => {
    if (!organizationName) return;
    document.title = `${organizationName} status`;
    return () => {
      document.title = 'SitePulse';
    };
  }, [organizationName]);

  return (
    <div className="status-page">
      <div className="status-page__inner">
        {loading && !data && (
          <div aria-busy="true">
            <span className="sr-only">Loading status…</span>
            <div className="skeleton" style={{ width: '40%', height: 24, marginBottom: 20 }} />
            <div className="status-hero">
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ width: '45%', height: 22, marginBottom: 10 }} />
                <div className="skeleton" style={{ width: '65%' }} />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="status-hero" role="alert">
            <HeroIcon status="unknown" />
            <div>
              <h1>Status page not found</h1>
              <p>
                No organization matches this address. Check the link, or{' '}
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={reload}
                  style={{ verticalAlign: 'baseline' }}
                >
                  try again
                </button>
                .
              </p>
            </div>
          </div>
        )}

        {data && (
          <>
            <header className="status-header">
              <h1>{data.organization.name}</h1>
              <span className="status-header__meta">
                Updated {relativeTime(data.updatedAt)} · refreshes automatically
              </span>
            </header>

            <div className={`status-hero status-hero--${data.overallStatus}`}>
              <HeroIcon status={data.overallStatus} />
              <div>
                <h2>{OVERALL_COPY[data.overallStatus].headline}</h2>
                <p>{OVERALL_COPY[data.overallStatus].detail}</p>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card__header">
                <h2>Services</h2>
              </div>

              {data.monitors.length === 0 ? (
                <div className="state">
                  <p style={{ margin: 0 }}>No services are being monitored yet.</p>
                </div>
              ) : (
                <ul className="service-list">
                  {data.monitors.map((monitor) => (
                    <li key={monitor.name} className="service-row">
                      <div>
                        <div className="service-row__name">{monitor.name}</div>
                        <div className="service-row__meta">
                          Last checked {relativeTime(monitor.lastCheckedAt)}
                        </div>
                      </div>
                      <div className="service-row__right">
                        {monitor.uptime24h !== null && (
                          <span className="uptime-meter" aria-hidden="true">
                            <span
                              className="uptime-meter__fill"
                              style={{
                                width: `${Math.max(0, Math.min(100, monitor.uptime24h))}%`,
                                background: `var(--${uptimeTone(monitor.uptime24h)})`,
                              }}
                            />
                          </span>
                        )}
                        <span className="service-row__uptime">
                          {monitor.uptime24h === null ? '—' : `${monitor.uptime24h}%`}
                          <span className="sr-only"> uptime over the last 24 hours</span>
                        </span>
                        <span className="service-row__status">
                          <StatusBadge status={monitor.status} />
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card">
              <div className="card__header">
                <h2>Recent incidents</h2>
              </div>

              {data.incidents.length === 0 ? (
                <div className="state">
                  <p style={{ margin: 0 }}>No incidents in the last 14 days.</p>
                </div>
              ) : (
                <ul className="incident-list">
                  {data.incidents.map((incident, index) => {
                    const ongoing = !incident.resolvedAt;
                    return (
                      <li
                        key={`${incident.title}-${incident.startedAt}-${index}`}
                        className="incident"
                      >
                        <span
                          className={`incident__dot incident__dot--${ongoing ? 'ongoing' : 'resolved'}`}
                          aria-hidden="true"
                        />
                        <div className="incident__body">
                          <div className="incident__head">
                            <span className="incident__title">{incident.title}</span>
                            <span
                              className={`status-badge status-badge--${ongoing ? 'down' : 'up'}`}
                            >
                              <span className="status-badge__dot" aria-hidden="true" />
                              {ongoing ? 'Ongoing' : 'Resolved'}
                            </span>
                          </div>
                          <div className="incident__meta">
                            {incident.monitorName && `${incident.monitorName} · `}
                            {absoluteTime(incident.startedAt)} ·{' '}
                            {ongoing
                              ? `ongoing for ${duration(incident.startedAt, null)}`
                              : `resolved after ${duration(incident.startedAt, incident.resolvedAt)}`}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <footer className="status-footer">
              Powered by
              <a href="/">
                <Brand size="sm" />
              </a>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
