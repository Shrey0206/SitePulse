import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { fetchPublic } from '../lib/api';
import { absoluteTime, duration, relativeTime } from '../lib/format';
import type { OverallStatus, StatusPage as StatusPageData } from '../lib/types';
import { useAsync } from '../lib/useAsync';

const OVERALL_COPY: Record<OverallStatus, { headline: string; detail: string }> = {
  operational: { headline: 'All systems operational', detail: 'Every monitored endpoint is responding normally.' },
  degraded: { headline: 'Degraded performance', detail: 'Some services are not responding as expected.' },
  major_outage: { headline: 'Major outage', detail: 'All monitored services are currently down.' },
  unknown: { headline: 'Status unavailable', detail: 'No monitoring data has been collected yet.' },
};

const REFRESH_MS = 30_000;

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

  return (
    <div className="status-page" data-theme="light">
      <div className="status-page__inner">
        {loading && !data && (
          <div className="status-hero status-hero--unknown" aria-busy="true">
            <span className="sr-only">Loading status…</span>
            <div className="skeleton" style={{ width: '45%', height: 22, marginBottom: 10 }} />
            <div className="skeleton" style={{ width: '65%' }} />
          </div>
        )}

        {error && (
          <div className="status-hero status-hero--unknown" role="alert">
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
        )}

        {data && (
          <>
            <div className={`status-hero status-hero--${data.overallStatus}`}>
              <h1>{OVERALL_COPY[data.overallStatus].headline}</h1>
              <p>{OVERALL_COPY[data.overallStatus].detail}</p>
              <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
                {data.organization.name} · updated {relativeTime(data.updatedAt)}
              </p>
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
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Service</th>
                      <th scope="col">Status</th>
                      <th scope="col">24h uptime</th>
                      <th scope="col">Last checked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.monitors.map((monitor) => (
                      <tr key={monitor.name}>
                        <td style={{ fontWeight: 500 }}>{monitor.name}</td>
                        <td>
                          <StatusBadge status={monitor.status} />
                        </td>
                        <td className="muted">
                          {monitor.uptime24h === null ? '—' : `${monitor.uptime24h}%`}
                        </td>
                        <td className="muted">{relativeTime(monitor.lastCheckedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                <div className="card__body" style={{ display: 'grid', gap: 14 }}>
                  {data.incidents.map((incident, index) => {
                    const ongoing = !incident.resolvedAt;
                    return (
                      <div
                        key={`${incident.title}-${incident.startedAt}-${index}`}
                        style={{
                          paddingLeft: 12,
                          borderLeft: `3px solid var(--${ongoing ? 'danger' : 'success'})`,
                        }}
                      >
                        <div style={{ fontWeight: 500 }}>{incident.title}</div>
                        <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
                          {incident.monitorName && `${incident.monitorName} · `}
                          {absoluteTime(incident.startedAt)} ·{' '}
                          {ongoing
                            ? `ongoing for ${duration(incident.startedAt, null)}`
                            : `resolved after ${duration(incident.startedAt, incident.resolvedAt)}`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <p className="faint" style={{ fontSize: 12, textAlign: 'center', marginTop: 24 }}>
              Powered by SitePulse
            </p>
          </>
        )}
      </div>
    </div>
  );
}
