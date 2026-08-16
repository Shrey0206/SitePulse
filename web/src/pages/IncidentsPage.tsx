import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../components/Modal';
import { EmptyState, ErrorState, LoadingRows } from '../components/States';
import { Toast, useToast } from '../components/Toast';
import { api } from '../lib/api';
import { absoluteTime, duration } from '../lib/format';
import type { Incident, Monitor } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { useLive } from '../state/hooks';

type StatusFilter = 'all' | 'open' | 'resolved';

export function IncidentsPage() {
  const live = useLive();
  const toast = useToast();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [monitorFilter, setMonitorFilter] = useState<string>('all');
  const [declaring, setDeclaring] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const query = new URLSearchParams();
  if (statusFilter !== 'all') query.set('status', statusFilter);
  if (monitorFilter !== 'all') query.set('monitorId', monitorFilter);
  const queryString = query.toString();

  const incidents = useAsync(
    useCallback(
      () => api.get<{ incidents: Incident[] }>(`/incidents${queryString ? `?${queryString}` : ''}`),
      [queryString],
    ),
    [queryString],
  );

  const monitors = useAsync(
    useCallback(() => api.get<{ monitors: Monitor[] }>('/monitors'), []),
    [],
  );

  // The SSE stream signals that an incident opened or resolved; refetching keeps the
  // timeline live without duplicating the server's filtering logic on the client.
  const incidentVersion = live?.incidentVersion ?? 0;
  const reloadIncidents = incidents.reload;
  useEffect(() => {
    if (incidentVersion > 0) reloadIncidents();
  }, [incidentVersion, reloadIncidents]);

  const monitorNames = new Map((monitors.data?.monitors ?? []).map((m) => [m.id, m.name]));

  async function declareIncident() {
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post('/incidents', { title, description: description || undefined });
      setDeclaring(false);
      setTitle('');
      setDescription('');
      incidents.reload();
      toast.success('Incident declared.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not declare incident');
    } finally {
      setSubmitting(false);
    }
  }

  async function resolveIncident(incident: Incident) {
    try {
      await api.post(`/incidents/${incident.id}/resolve`);
      incidents.reload();
      toast.success('Incident resolved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not resolve incident');
    }
  }

  const list = incidents.data?.incidents ?? [];
  // Open incidents first, so an ongoing outage is never below the fold (UI_DESIGN.md §3).
  const sorted = [...list].sort((a, b) => {
    if (!a.resolvedAt && b.resolvedAt) return -1;
    if (a.resolvedAt && !b.resolvedAt) return 1;
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Incidents</h1>
          <p>Auto-detected outages and manually declared events.</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setDeclaring(true)}>
          Declare incident
        </button>
      </div>

      <div className="card">
        <div className="card__header">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <label htmlFor="statusFilter" className="faint" style={{ fontSize: 12 }}>
              Status
            </label>
            <select
              id="statusFilter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              style={{ fontSize: 13, padding: '4px 8px' }}
            >
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
            </select>

            <label htmlFor="monitorFilter" className="faint" style={{ fontSize: 12 }}>
              Monitor
            </label>
            <select
              id="monitorFilter"
              value={monitorFilter}
              onChange={(e) => setMonitorFilter(e.target.value)}
              style={{ fontSize: 13, padding: '4px 8px' }}
            >
              <option value="all">All</option>
              {(monitors.data?.monitors ?? []).map((monitor) => (
                <option key={monitor.id} value={monitor.id}>
                  {monitor.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {incidents.loading && <LoadingRows />}
        {!incidents.loading && incidents.error && (
          <ErrorState error={incidents.error} onRetry={incidents.reload} />
        )}

        {!incidents.loading && !incidents.error && sorted.length === 0 && (
          <EmptyState
            title="No incidents"
            message={
              statusFilter === 'all'
                ? 'Nothing has gone wrong yet. Incidents appear here automatically when a monitor goes down.'
                : `No ${statusFilter} incidents match the current filters.`
            }
          />
        )}

        {!incidents.loading && !incidents.error && sorted.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Incident</th>
                <th scope="col">Source</th>
                <th scope="col">Started</th>
                <th scope="col">Duration</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((incident) => {
                const open = !incident.resolvedAt;
                return (
                  <tr key={incident.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{incident.title}</div>
                      {incident.monitorId && (
                        <div className="faint" style={{ fontSize: 12 }}>
                          {monitorNames.get(incident.monitorId) ?? 'Unknown monitor'}
                        </div>
                      )}
                    </td>
                    <td>
                      {/* auto vs manual matters: auto incidents alert, manual ones don't. */}
                      <span className={`status-badge status-badge--${incident.source === 'auto' ? 'down' : 'unknown'}`}>
                        <span className="status-badge__dot" aria-hidden="true" />
                        {incident.source === 'auto' ? 'Detected' : 'Declared'}
                      </span>
                    </td>
                    <td className="muted">{absoluteTime(incident.startedAt)}</td>
                    <td className="muted">{duration(incident.startedAt, incident.resolvedAt)}</td>
                    <td>
                      <span className={`status-badge status-badge--${open ? 'degraded' : 'up'}`}>
                        <span className="status-badge__dot" aria-hidden="true" />
                        {open ? 'Ongoing' : 'Resolved'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {open && (
                        <button
                          type="button"
                          className="btn btn--sm"
                          onClick={() => void resolveIncident(incident)}
                        >
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {declaring && (
        <Modal
          title="Declare an incident"
          onClose={() => setDeclaring(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setDeclaring(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={submitting || !title.trim()}
                onClick={() => void declareIncident()}
              >
                {submitting ? 'Declaring…' : 'Declare'}
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="incidentTitle">Title</label>
            <input
              id="incidentTitle"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Scheduled database maintenance"
            />
          </div>

          <div className="field">
            <label htmlFor="incidentDescription">Description (optional)</label>
            <textarea
              id="incidentDescription"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Manual incidents are silent by design; saying so avoids the assumption that
              declaring one notifies people. */}
          <p className="field__hint">
            Declared incidents appear on your status page and timeline but do not send alerts.
          </p>

          {formError && (
            <p className="field__error" role="alert">
              {formError}
            </p>
          )}
        </Modal>
      )}

      <Toast message={toast.message} onDismiss={toast.dismiss} />
    </>
  );
}
