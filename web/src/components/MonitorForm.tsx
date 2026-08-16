import { useState, type FormEvent } from 'react';
import type { Monitor } from '../lib/types';

export interface MonitorFormValues {
  name: string;
  url: string;
  intervalSeconds: number;
  timeoutSeconds: number;
  expectedStatus: number;
  failureThreshold: number;
  recoveryThreshold: number;
}

const DEFAULTS: MonitorFormValues = {
  name: '',
  url: '',
  intervalSeconds: 60,
  timeoutSeconds: 10,
  expectedStatus: 200,
  failureThreshold: 3,
  recoveryThreshold: 3,
};

export function MonitorForm({
  monitor,
  onSubmit,
  onCancel,
  submitting,
  error,
}: {
  monitor?: Monitor;
  onSubmit: (values: MonitorFormValues) => void;
  onCancel: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const [values, setValues] = useState<MonitorFormValues>(
    monitor
      ? {
          name: monitor.name,
          url: monitor.url,
          intervalSeconds: monitor.intervalSeconds,
          timeoutSeconds: monitor.timeoutSeconds,
          expectedStatus: monitor.expectedStatus,
          failureThreshold: monitor.failureThreshold,
          recoveryThreshold: monitor.recoveryThreshold,
        }
      : DEFAULTS,
  );

  // Mirrors the server's cross-field rule so the user finds out before submitting rather
  // than via a 400. The server still enforces it -- this is convenience, not the guarantee.
  const timeoutTooLong = values.timeoutSeconds > values.intervalSeconds;

  function set<K extends keyof MonitorFormValues>(key: K, value: MonitorFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (timeoutTooLong) return;
    onSubmit(values);
  }

  return (
    <form onSubmit={handleSubmit} id="monitor-form" noValidate>
      <div className="field">
        <label htmlFor="name">Name</label>
        <input id="name" required value={values.name} onChange={(e) => set('name', e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="url">URL</label>
        <input
          id="url"
          type="url"
          required
          placeholder="https://example.com/health"
          value={values.url}
          onChange={(e) => set('url', e.target.value)}
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="intervalSeconds">Check interval (seconds)</label>
          <input
            id="intervalSeconds"
            type="number"
            min={10}
            max={86400}
            required
            value={values.intervalSeconds}
            onChange={(e) => set('intervalSeconds', Number(e.target.value))}
          />
        </div>

        <div className="field">
          <label htmlFor="timeoutSeconds">Timeout (seconds)</label>
          <input
            id="timeoutSeconds"
            type="number"
            min={1}
            max={300}
            required
            value={values.timeoutSeconds}
            onChange={(e) => set('timeoutSeconds', Number(e.target.value))}
            aria-invalid={timeoutTooLong}
            aria-describedby={timeoutTooLong ? 'timeout-error' : undefined}
          />
          {timeoutTooLong && (
            <span className="field__error" id="timeout-error">
              Must not exceed the check interval.
            </span>
          )}
        </div>
      </div>

      <div className="field">
        <label htmlFor="expectedStatus">Expected status code</label>
        <input
          id="expectedStatus"
          type="number"
          min={100}
          max={599}
          required
          value={values.expectedStatus}
          onChange={(e) => set('expectedStatus', Number(e.target.value))}
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="failureThreshold">Failure threshold</label>
          <input
            id="failureThreshold"
            type="number"
            min={1}
            max={20}
            required
            value={values.failureThreshold}
            onChange={(e) => set('failureThreshold', Number(e.target.value))}
            aria-describedby="failure-hint"
          />
          <span className="field__hint" id="failure-hint">
            Consecutive failures before alerting.
          </span>
        </div>

        <div className="field">
          <label htmlFor="recoveryThreshold">Recovery threshold</label>
          <input
            id="recoveryThreshold"
            type="number"
            min={1}
            max={20}
            required
            value={values.recoveryThreshold}
            onChange={(e) => set('recoveryThreshold', Number(e.target.value))}
            aria-describedby="recovery-hint"
          />
          <span className="field__hint" id="recovery-hint">
            Consecutive successes before recovery.
          </span>
        </div>
      </div>

      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={submitting || timeoutTooLong}>
          {submitting ? 'Saving…' : monitor ? 'Save changes' : 'Create monitor'}
        </button>
      </div>
    </form>
  );
}
