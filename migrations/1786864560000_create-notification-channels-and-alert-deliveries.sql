-- Up Migration

CREATE TYPE notification_channel_type AS ENUM ('email', 'webhook');
CREATE TYPE alert_delivery_status AS ENUM ('sent', 'failed');
CREATE TYPE alert_event AS ENUM ('incident_opened', 'incident_resolved');

CREATE TABLE notification_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type notification_channel_type NOT NULL,
  -- Email address for type='email', endpoint URL for type='webhook'.
  target TEXT NOT NULL,
  -- Webhook HMAC secret, AES-256-GCM encrypted rather than hashed: it has to be read back
  -- in plaintext to sign outgoing requests, which a one-way hash can't do (DECISIONS.md
  -- #23). Always NULL for email channels.
  secret_encrypted TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_channels_secret_only_for_webhooks
    CHECK (type = 'webhook' OR secret_encrypted IS NULL)
);

CREATE INDEX notification_channels_organization_id_idx ON notification_channels (organization_id);

CREATE TRIGGER notification_channels_set_updated_at
  BEFORE UPDATE ON notification_channels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Logs every attempted notification on both channels, not webhooks only (DECISIONS.md
-- #33) -- an SMTP send can fail silently (bad credentials, provider rejection) just as
-- easily as a webhook can time out, and a monitoring product whose own alert pipeline is
-- unobservable on one channel undercuts the point of logging at all.
CREATE TABLE alert_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  -- Kept nullable so deleting a channel doesn't erase the delivery history that proves
  -- whether alerts were actually sent.
  notification_channel_id UUID REFERENCES notification_channels(id) ON DELETE SET NULL,
  channel notification_channel_type NOT NULL,
  event alert_event NOT NULL,
  status alert_delivery_status NOT NULL,
  target TEXT NOT NULL,
  -- HTTP status for webhooks; NULL for email, which has no equivalent.
  response_code INTEGER,
  latency_ms INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX alert_deliveries_organization_id_created_at_idx
  ON alert_deliveries (organization_id, created_at DESC);
CREATE INDEX alert_deliveries_incident_id_idx ON alert_deliveries (incident_id);

-- Down Migration

DROP TABLE IF EXISTS alert_deliveries;
DROP TABLE IF EXISTS notification_channels;
DROP TYPE IF EXISTS alert_event;
DROP TYPE IF EXISTS alert_delivery_status;
DROP TYPE IF EXISTS notification_channel_type;
