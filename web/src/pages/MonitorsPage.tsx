import { useCallback, useState } from 'react';
import { Modal } from '../components/Modal';
import { MonitorForm, type MonitorFormValues } from '../components/MonitorForm';
import { EmptyState, ErrorState, LoadingRows } from '../components/States';
import { StatusBadge } from '../components/StatusBadge';
import { Toast, useToast } from '../components/Toast';
import { api } from '../lib/api';
import { formatInterval, relativeTime } from '../lib/format';
import type { Monitor, MonitorStatus } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { useLive } from '../state/hooks';

interface MonitorWithStatus extends Monitor {
  status?: MonitorStatus;
  lastCheckedAt?: string | null;
}

export function MonitorsPage() {
  const live = useLive();
  const toast = useToast();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Monitor | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(
    useCallback(() => api.get<{ monitors: MonitorWithStatus[] }>('/monitors'), []),
    [],
  );

  async function createMonitor(values: MonitorFormValues) {
    setSubmitting(true);
    setFormError(null);
    try {
      await api.post('/monitors', values);
      setCreating(false);
      reload();
      toast.success(`Monitor "${values.name}" created.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create monitor');
    } finally {
      setSubmitting(false);
    }
  }

  async function updateMonitor(values: MonitorFormValues) {
    if (!editing) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await api.patch(`/monitors/${editing.id}`, values);
      setEditing(null);
      reload();
      toast.success('Monitor updated.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not update monitor');
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteMonitor(monitor: Monitor) {
    if (!window.confirm(`Delete "${monitor.name}"? Its check history will be removed too.`)) return;
    try {
      await api.delete(`/monitors/${monitor.id}`);
      reload();
      toast.success(`Deleted "${monitor.name}".`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete monitor');
    }
  }

  const monitors = data?.monitors ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Monitors</h1>
          <p>Endpoints checked on a schedule. Status updates live.</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
          New monitor
        </button>
      </div>

      <div className="card">
        {loading && <LoadingRows />}

        {!loading && error && <ErrorState error={error} onRetry={reload} />}

        {!loading && !error && monitors.length === 0 && (
          <EmptyState
            title="No monitors yet"
            message="Add an endpoint and SitePulse will start checking it on your chosen interval."
            action={
              <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
                Create your first monitor
              </button>
            }
          />
        )}

        {!loading && !error && monitors.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Monitor</th>
                <th scope="col">Status</th>
                <th scope="col">Interval</th>
                <th scope="col">Thresholds</th>
                <th scope="col">Last checked</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {monitors.map((monitor) => {
                // A live SSE update takes precedence over the value from the last fetch.
                const status = live?.statuses[monitor.id] ?? monitor.status ?? 'pending';

                return (
                  <tr key={monitor.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{monitor.name}</div>
                      <div className="mono faint">{monitor.url}</div>
                    </td>
                    <td>
                      <StatusBadge status={status} />
                    </td>
                    <td className="muted">{formatInterval(monitor.intervalSeconds)}</td>
                    <td className="muted">
                      {monitor.failureThreshold} down / {monitor.recoveryThreshold} up
                    </td>
                    <td className="muted">{relativeTime(monitor.lastCheckedAt ?? null)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => {
                          setFormError(null);
                          setEditing(monitor);
                        }}
                      >
                        Edit
                      </button>{' '}
                      <button
                        type="button"
                        className="btn btn--sm btn--danger"
                        onClick={() => void deleteMonitor(monitor)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <Modal title="New monitor" onClose={() => setCreating(false)}>
          <MonitorForm
            onSubmit={(values) => void createMonitor(values)}
            onCancel={() => setCreating(false)}
            submitting={submitting}
            error={formError}
          />
        </Modal>
      )}

      {editing && (
        <Modal title={`Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <MonitorForm
            monitor={editing}
            onSubmit={(values) => void updateMonitor(values)}
            onCancel={() => setEditing(null)}
            submitting={submitting}
            error={formError}
          />
        </Modal>
      )}

      <Toast message={toast.message} onDismiss={toast.dismiss} />
    </>
  );
}
