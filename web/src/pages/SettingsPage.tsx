import { useCallback, useState } from 'react';
import { Modal } from '../components/Modal';
import { EmptyState, ErrorState, LoadingRows } from '../components/States';
import { Toast, useToast } from '../components/Toast';
import { api } from '../lib/api';
import { absoluteTime, relativeTime } from '../lib/format';
import type { ApiKey } from '../lib/types';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../state/hooks';

export function SettingsPage() {
  const { organization } = useAuth();
  const toast = useToast();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const keys = useAsync(
    useCallback(() => api.get<{ apiKeys: ApiKey[] }>('/keys'), []),
    [],
  );

  async function createKey() {
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await api.post<{ key: string }>('/keys', { name });
      setCreating(false);
      setName('');
      keys.reload();
      setRevealedKey(result.key);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create API key');
    } finally {
      setSubmitting(false);
    }
  }

  async function revokeKey(key: ApiKey) {
    if (!window.confirm(`Revoke "${key.name}"? Any client using it will stop working immediately.`)) return;
    try {
      await api.delete(`/keys/${key.id}`);
      keys.reload();
      toast.success('API key revoked.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not revoke key');
    }
  }

  const keyList = keys.data?.apiKeys ?? [];
  const statusUrl = organization ? `${window.location.origin}/status/${organization.slug}` : '';

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Organization details and programmatic access.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card__header">
          <h2>Organization</h2>
        </div>
        <div className="card__body">
          <div className="field" style={{ marginBottom: 12 }}>
            <label>Name</label>
            <div>{organization?.name ?? '—'}</div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Public status page</label>
            <a href={statusUrl} target="_blank" rel="noreferrer" className="mono">
              {statusUrl}
            </a>
            <span className="field__hint">Readable by anyone, no sign-in required.</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <h2>API keys</h2>
          <button type="button" className="btn btn--sm btn--primary" onClick={() => setCreating(true)}>
            Create key
          </button>
        </div>

        {keys.loading && <LoadingRows rows={2} />}
        {!keys.loading && keys.error && <ErrorState error={keys.error} onRetry={keys.reload} />}
        {!keys.loading && !keys.error && keyList.length === 0 && (
          <EmptyState
            title="No API keys"
            message="Create a key to manage monitors and incidents programmatically."
            action={
              <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
                Create your first key
              </button>
            }
          />
        )}

        {!keys.loading && !keys.error && keyList.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Key</th>
                <th scope="col">Last used</th>
                <th scope="col">State</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keyList.map((key) => (
                <tr key={key.id}>
                  <td style={{ fontWeight: 500 }}>{key.name}</td>
                  {/* Only the prefix exists server-side; the rest is hashed. */}
                  <td className="mono faint">{key.keyPrefix}…</td>
                  <td className="muted">{relativeTime(key.lastUsedAt)}</td>
                  <td>
                    <span className={`status-badge status-badge--${key.revokedAt ? 'unknown' : 'up'}`}>
                      <span className="status-badge__dot" aria-hidden="true" />
                      {key.revokedAt ? 'Revoked' : 'Active'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {!key.revokedAt && (
                      <button
                        type="button"
                        className="btn btn--sm btn--danger"
                        onClick={() => void revokeKey(key)}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <Modal
          title="Create API key"
          onClose={() => setCreating(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={submitting || !name.trim()}
                onClick={() => void createKey()}
              >
                {submitting ? 'Creating…' : 'Create key'}
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="keyName">Name</label>
            <input
              id="keyName"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="CI pipeline"
              aria-describedby="key-hint"
            />
            <span className="field__hint" id="key-hint">
              Keys have full access within this organization and never expire until revoked.
            </span>
          </div>

          {formError && (
            <p className="field__error" role="alert">
              {formError}
            </p>
          )}
        </Modal>
      )}

      {revealedKey && (
        <Modal
          title="Save your API key"
          onClose={() => setRevealedKey(null)}
          footer={
            <button type="button" className="btn btn--primary" onClick={() => setRevealedKey(null)}>
              I have saved it
            </button>
          }
        >
          <p style={{ marginTop: 0 }}>
            Send this as an <span className="mono">X-API-Key</span> header. Only a hash is stored, so
            this is the only time it can be shown.
          </p>
          <div
            className="mono"
            style={{
              padding: 10,
              background: 'var(--bg-inset)',
              border: '1px solid var(--border-strong)',
              borderRadius: 4,
              wordBreak: 'break-all',
            }}
          >
            {revealedKey}
          </div>
          <p className="field__hint" style={{ marginTop: 10 }}>
            Created {absoluteTime(new Date().toISOString())}.
          </p>
        </Modal>
      )}

      <Toast message={toast.message} onDismiss={toast.dismiss} />
    </>
  );
}
