-- Up Migration

-- Discord and Slack incoming-webhook channels (DECISIONS.md #38).
ALTER TYPE notification_channel_type ADD VALUE IF NOT EXISTS 'discord';
ALTER TYPE notification_channel_type ADD VALUE IF NOT EXISTS 'slack';

-- secret_encrypted used to be webhook-only. A Discord/Slack webhook URL is itself a
-- credential (anyone holding it can post to the channel), so it is stored encrypted in the
-- same column and `target` holds a masked label instead. Email still never has a secret.
--
-- No matching "chat channels must have a secret" constraint: Postgres will not let a new enum
-- value be used in the transaction that adds it, and the delivery code already handles a
-- missing URL by logging a failed delivery.
ALTER TABLE notification_channels DROP CONSTRAINT notification_channels_secret_only_for_webhooks;
ALTER TABLE notification_channels
  ADD CONSTRAINT notification_channels_no_secret_for_email
  CHECK (type <> 'email' OR secret_encrypted IS NULL);

-- Down Migration

-- Postgres cannot drop an enum value, so rebuild the type. Chat channels and their delivery
-- history cannot be represented without the values, so they are removed.
DELETE FROM alert_deliveries WHERE channel IN ('discord', 'slack');
DELETE FROM notification_channels WHERE type IN ('discord', 'slack');

ALTER TABLE notification_channels DROP CONSTRAINT notification_channels_no_secret_for_email;

ALTER TYPE notification_channel_type RENAME TO notification_channel_type_old;
CREATE TYPE notification_channel_type AS ENUM ('email', 'webhook');

ALTER TABLE notification_channels
  ALTER COLUMN type TYPE notification_channel_type USING type::text::notification_channel_type;
ALTER TABLE alert_deliveries
  ALTER COLUMN channel TYPE notification_channel_type USING channel::text::notification_channel_type;

DROP TYPE notification_channel_type_old;

ALTER TABLE notification_channels
  ADD CONSTRAINT notification_channels_secret_only_for_webhooks
  CHECK (type = 'webhook' OR secret_encrypted IS NULL);
