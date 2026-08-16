export type MonitorStatus = 'pending' | 'up' | 'suspected_down' | 'down' | 'suspected_up';

export interface Monitor {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  intervalSeconds: number;
  timeoutSeconds: number;
  expectedStatus: number;
  failureThreshold: number;
  recoveryThreshold: number;
  createdAt: string;
  updatedAt: string;
}

export interface Incident {
  id: string;
  monitorId: string | null;
  source: 'auto' | 'manual';
  title: string;
  description: string | null;
  startedAt: string;
  resolvedAt: string | null;
}

export interface NotificationChannel {
  id: string;
  type: 'email' | 'webhook';
  target: string;
  enabled: boolean;
  createdAt: string;
}

export interface AlertDelivery {
  id: string;
  incidentId: string;
  channel: 'email' | 'webhook';
  event: 'incident_opened' | 'incident_resolved';
  status: 'sent' | 'failed';
  target: string;
  responseCode: number | null;
  latencyMs: number | null;
  error: string | null;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

export interface User {
  id: string;
  email: string;
  organizationId: string;
}

/** Public status pages report a coarser status than the internal state machine. */
export type PublicStatus = 'operational' | 'degraded' | 'down' | 'unknown';
export type OverallStatus = 'operational' | 'degraded' | 'major_outage' | 'unknown';

export interface StatusPage {
  organization: { name: string; slug: string };
  overallStatus: OverallStatus;
  monitors: {
    name: string;
    status: PublicStatus;
    uptime24h: number | null;
    lastCheckedAt: string | null;
  }[];
  incidents: {
    title: string;
    monitorName: string | null;
    startedAt: string;
    resolvedAt: string | null;
  }[];
  updatedAt: string;
}
