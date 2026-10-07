export type ChannelType = 'email' | 'webhook' | 'discord' | 'slack';
export type AlertEvent = 'incident_opened' | 'incident_resolved';
export type DeliveryStatus = 'sent' | 'failed';

export interface NotificationChannel {
  id: string;
  organizationId: string;
  type: ChannelType;
  /**
   * What the channel is shown as. Email address or endpoint URL for email/webhook; a masked
   * label for discord/slack, whose real URL lives encrypted in `secretEncrypted`.
   */
  target: string;
  enabled: boolean;
  /**
   * Ciphertext as stored, decrypted per-channel at delivery time rather than eagerly for
   * the whole batch. Eager decryption meant one unusable secret threw for every channel,
   * silently disabling all alerting for the organization -- see alerts.service.ts.
   * A webhook's HMAC signing secret, or a discord/slack channel's webhook URL.
   */
  secretEncrypted: string | null;
}

export interface AlertContext {
  organizationId: string;
  incidentId: string;
  event: AlertEvent;
  monitorName: string;
  monitorUrl: string;
  occurredAt: Date;
}

export interface DeliveryOutcome {
  status: DeliveryStatus;
  responseCode: number | null;
  latencyMs: number;
  error: string | null;
}
