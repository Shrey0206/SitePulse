import { useCallback, useState } from 'react';
import { Modal } from '../components/Modal';
import { EmptyState, ErrorState, LoadingRows } from '../components/States';
import { Toast, useToast } from '../components/Toast';
import { api } from '../lib/api';
import { absoluteTime } from '../lib/format';
import type { AlertDelivery, ChannelType, NotificationChannel } from '../lib/types';
import { useAsync } from '../lib/useAsync';

const CHANNEL_LABEL: Record<ChannelType, string> = {
  email: 'Email',
  webhook: 'Webhook',
  discord: 'Discord',
  slack: 'Slack',
};

/** What the target field asks for, per channel type. */
const TARGET_FIELD: Record<ChannelType, { label: string; placeholder: string; hint: string | null }> = {
  email: { label: 'Email address', placeholder: 'oncall@example.com', hint: null },
  webhook: {
    label: 'Endpoint URL',
    placeholder: 'https://example.com/hooks/sitepulse',
    hint: 'Requests are signed with HMAC-SHA256. You will get a signing secret once, on creation.',
  },
  discord: {
    label: 'Discord webhook URL',
    placeholder: 'https://discord.com/api/webhooks/…',
    hint: 'In Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL. The URL is a secret: it is stored encrypted and never shown again.',
  },
  slack: {
    label: 'Slack webhook URL',
    placeholder: 'https://hooks.slack.com/services/…',
    hint: 'Create an Incoming Webhook for your workspace in Slack’s app settings and paste its URL. The URL is a secret: it is stored encrypted and never shown again.',
  },
};

export function AlertsPage() {
  const toast = useToast();

  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<ChannelType>('email');
  const [target, setTarget] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Shown once after creating a webhook channel; the server never returns it again.
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const channels = useAsync(
    useCallback(() => api.get<{ channels: NotificationChannel[] }>('/alerts/channels'), []),
    [],
  );

  const deliveries = useAsync(
    useCallback(() => api.get<{ deliveries: AlertDelivery[] }>('/alerts/deliveries?limit=25'), []),
    [],
  );

  async function addChannel() {
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await api.post<{ channel: NotificationChannel; secret?: string }>(
        '/alerts/channels',
        { type, target },
      );
      setAdding(false);
      setTarget('');
      channels.reload();

      if (result.secret) {
        setRevealedSecret(result.secret);
      } else {
        toast.success('Notification channel added.');
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not add channel');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleChannel(channel: NotificationChannel) {
    try {
      await api.patch(`/alerts/channels/${channel.id}`, { enabled: !channel.enabled });
      channels.reload();
      toast.success(channel.enabled ? 'Channel disabled.' : 'Channel enabled.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update channel');
    }
  }

  async function deleteChannel(channel: NotificationChannel) {
    if (!window.confirm(`Remove ${channel.target}?`)) return;
    try {
      await api.delete(`/alerts/channels/${channel.id}`);
      channels.reload();
      toast.success('Channel removed.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove channel');
    }
  }

  const channelList = channels.data?.channels ?? [];
  const deliveryList = deliveries.data?.deliveries ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Alerts</h1>
          <p>Where SitePulse sends notifications when an incident opens or resolves.</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
          Add channel
        </button>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card__header">
          <h2>Notification channels</h2>
        </div>

        {channels.loading && <LoadingRows rows={2} />}
        {!channels.loading && channels.error && (
          <ErrorState error={channels.error} onRetry={channels.reload} />
        )}
        {!channels.loading && !channels.error && channelList.length === 0 && (
          <EmptyState
            title="No channels configured"
            message="Add a Discord or Slack channel, a webhook endpoint, or an email address to be notified when a monitor goes down."
            action={
              <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
                Add a channel
              </button>
            }
          />
        )}

        {!channels.loading && !channels.error && channelList.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Destination</th>
                <th scope="col">Type</th>
                <th scope="col">State</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {channelList.map((channel) => (
                <tr key={channel.id}>
                  <td className="mono">{channel.target}</td>
                  <td className="muted">{CHANNEL_LABEL[channel.type]}</td>
                  <td>
                    <span className={`status-badge status-badge--${channel.enabled ? 'up' : 'unknown'}`}>
                      <span className="status-badge__dot" aria-hidden="true" />
                      {channel.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => void toggleChannel(channel)}
                    >
                      {channel.enabled ? 'Disable' : 'Enable'}
                    </button>{' '}
                    <button
                      type="button"
                      className="btn btn--sm btn--danger"
                      onClick={() => void deleteChannel(channel)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card__header">
          <h2>Delivery log</h2>
          <button type="button" className="btn btn--sm" onClick={deliveries.reload}>
            Refresh
          </button>
        </div>

        {deliveries.loading && <LoadingRows rows={3} />}
        {!deliveries.loading && deliveries.error && (
          <ErrorState error={deliveries.error} onRetry={deliveries.reload} />
        )}
        {!deliveries.loading && !deliveries.error && deliveryList.length === 0 && (
          <EmptyState
            title="No alerts sent yet"
            message="Every notification attempt is recorded here, including failures and why they failed."
          />
        )}

        {!deliveries.loading && !deliveries.error && deliveryList.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Event</th>
                <th scope="col">Destination</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {deliveryList.map((delivery) => (
                <tr key={delivery.id}>
                  <td className="muted">{absoluteTime(delivery.createdAt)}</td>
                  <td className="muted">
                    {delivery.event === 'incident_opened' ? 'Incident opened' : 'Incident resolved'}
                  </td>
                  <td className="mono">{delivery.target}</td>
                  <td>
                    <span className={`status-badge status-badge--${delivery.status === 'sent' ? 'up' : 'down'}`}>
                      <span className="status-badge__dot" aria-hidden="true" />
                      {delivery.status === 'sent' ? 'Sent' : 'Failed'}
                    </span>
                    {/* The failure reason is the whole point of the log -- surface it
                        inline rather than making the user dig for it. */}
                    {delivery.error && (
                      <div className="faint" style={{ fontSize: 11, marginTop: 3 }}>
                        {delivery.error}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {adding && (
        <Modal
          title="Add notification channel"
          onClose={() => setAdding(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={submitting || !target.trim()}
                onClick={() => void addChannel()}
              >
                {submitting ? 'Adding…' : 'Add channel'}
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="channelType">Type</label>
            <select
              id="channelType"
              value={type}
              onChange={(e) => {
                setType(e.target.value as ChannelType);
                // A pasted address or URL is meaningless for a different channel type.
                setTarget('');
                setFormError(null);
              }}
            >
              {(Object.keys(CHANNEL_LABEL) as ChannelType[]).map((value) => (
                <option key={value} value={value}>
                  {CHANNEL_LABEL[value]}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="channelTarget">{TARGET_FIELD[type].label}</label>
            <input
              id="channelTarget"
              type={type === 'email' ? 'email' : 'url'}
              required
              autoComplete="off"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={TARGET_FIELD[type].placeholder}
            />
            {TARGET_FIELD[type].hint && <span className="field__hint">{TARGET_FIELD[type].hint}</span>}
          </div>

          {formError && (
            <p className="field__error" role="alert">
              {formError}
            </p>
          )}
        </Modal>
      )}

      {revealedSecret && (
        <Modal
          title="Save your signing secret"
          onClose={() => setRevealedSecret(null)}
          footer={
            <button type="button" className="btn btn--primary" onClick={() => setRevealedSecret(null)}>
              I have saved it
            </button>
          }
        >
          <p style={{ marginTop: 0 }}>
            Use this to verify the <span className="mono">X-SitePulse-Signature</span> header on
            incoming webhooks. It is stored encrypted and cannot be shown again.
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
            {revealedSecret}
          </div>
        </Modal>
      )}

      <Toast message={toast.message} onDismiss={toast.dismiss} />
    </>
  );
}
