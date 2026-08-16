export type ChannelType = 'email' | 'webhook';
export type AlertEvent = 'incident_opened' | 'incident_resolved';
export type DeliveryStatus = 'sent' | 'failed';

export interface NotificationChannel {
  id: string;
  organizationId: string;
  type: ChannelType;
  target: string;
  enabled: boolean;
  /** Decrypted webhook signing secret; null for email channels. */
  secret: string | null;
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
