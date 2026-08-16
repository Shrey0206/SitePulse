import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../../db/pool.js';
import { AppError } from '../../shared/errors/AppError.js';

const KEY_PREFIX = 'sp_live_';
const PREFIX_DISPLAY_LENGTH = 8;

export interface ApiKeyView {
  id: string;
  organizationId: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

interface ApiKeyRow {
  id: string;
  organization_id: string;
  name: string;
  key_prefix: string;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

function toView(row: ApiKeyRow): ApiKeyView {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function generateApiKey(): string {
  return `${KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
}

// key_hash is never selected -- the API has no read path that needs it, and leaving it
// out entirely beats remembering to strip it.
const VIEW_COLUMNS = 'id, organization_id, name, key_prefix, last_used_at, revoked_at, created_at';

/** The plaintext key is returned exactly once here and is unrecoverable afterwards. */
export async function createApiKey(
  organizationId: string,
  name: string,
): Promise<{ apiKey: ApiKeyView; key: string }> {
  const key = generateApiKey();

  const result = await pool.query<ApiKeyRow>(
    `INSERT INTO api_keys (organization_id, name, key_hash, key_prefix)
     VALUES ($1, $2, $3, $4)
     RETURNING ${VIEW_COLUMNS}`,
    [organizationId, name, hashApiKey(key), key.slice(0, KEY_PREFIX.length + PREFIX_DISPLAY_LENGTH)],
  );

  return { apiKey: toView(result.rows[0]!), key };
}

export async function listApiKeys(organizationId: string): Promise<ApiKeyView[]> {
  const result = await pool.query<ApiKeyRow>(
    `SELECT ${VIEW_COLUMNS} FROM api_keys WHERE organization_id = $1 ORDER BY created_at DESC`,
    [organizationId],
  );
  return result.rows.map(toView);
}

export async function revokeApiKey(organizationId: string, apiKeyId: string): Promise<ApiKeyView> {
  // Revoked rather than deleted, so a key that appears in logs stays identifiable
  // afterwards. v1 keys never expire on their own (DECISIONS.md #37).
  const result = await pool.query<ApiKeyRow>(
    `UPDATE api_keys SET revoked_at = now()
     WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL
     RETURNING ${VIEW_COLUMNS}`,
    [apiKeyId, organizationId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'API_KEY_NOT_FOUND', 'Active API key not found');
  return toView(row);
}

export interface VerifiedApiKey {
  id: string;
  organizationId: string;
}

/**
 * Looked up by exact hash match on an indexed column -- the reason a fast hash is correct
 * here and bcrypt is not (DECISIONS.md #29). bcrypt would force a row-by-row compare.
 */
export async function verifyApiKey(presentedKey: string): Promise<VerifiedApiKey | null> {
  if (!presentedKey.startsWith(KEY_PREFIX)) return null;

  const result = await pool.query<{ id: string; organization_id: string }>(
    `SELECT id, organization_id FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
    [hashApiKey(presentedKey)],
  );
  const row = result.rows[0];
  if (!row) return null;

  // Fire-and-forget: last_used_at is diagnostic, and awaiting a write on every
  // authenticated request would put an extra round trip in the hot path.
  void pool
    .query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [row.id])
    .catch((err: unknown) => console.error('Failed to update api key last_used_at:', err));

  return { id: row.id, organizationId: row.organization_id };
}
