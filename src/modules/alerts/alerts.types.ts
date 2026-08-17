export type ChannelType = 'email' | 'webhook';
export type AlertEvent = 'incident_opened' | 'incident_resolved';
export type DeliveryStatus = 'sent' | 'failed';

export interface NotificationChannel {
  id: string;
  organizationId: string;
  type: ChannelType;
  target: string;
  enabled: boolean;
  /**
   * Ciphertext as stored, decrypted per-channel at delivery time rather than eagerly for
   * the whole batch. Eager decryption meant one unusable secret threw for every channel,
   * silently disabling all alerting for the organization -- see alerts.service.ts.
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
