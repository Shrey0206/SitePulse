-- Up Migration

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- SHA-256 of the full key, not bcrypt (DECISIONS.md #29): bcrypt's slowness defends
  -- low-entropy human secrets and can't be looked up by index. An API key is already
  -- high-entropy and random, so it needs neither property -- it needs an indexable hash.
  key_hash TEXT NOT NULL,
  -- First 8 chars, stored unhashed purely so the UI can identify a key it can never
  -- show again.
  key_prefix TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX api_keys_key_hash_idx ON api_keys (key_hash);
CREATE INDEX api_keys_organization_id_idx ON api_keys (organization_id);

-- Down Migration

DROP TABLE IF EXISTS api_keys;
