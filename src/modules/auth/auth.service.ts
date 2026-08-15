import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { AppError } from '../../shared/errors/AppError.js';
import { isUniqueViolation } from '../../shared/utils/db-errors.js';
import { randomSlugSuffix, slugify } from '../../shared/utils/slug.js';
import type { LoginInput, SignupInput } from './auth.schemas.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_TTL_MS,
  signAccessToken,
} from './auth.tokens.js';

interface Organization {
  id: string;
  name: string;
  slug: string;
}

interface AuthUser {
  id: string;
  email: string;
  organizationId: string;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const MAX_SLUG_ATTEMPTS = 5;
const INVALID_REFRESH_TOKEN_MESSAGE = 'Invalid refresh token';

// Used to keep login timing similar whether or not the email exists, so response
// time can't be used to enumerate registered accounts.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-password', 12);

async function createOrganizationWithRetry(client: PoolClient, name: string): Promise<Organization> {
  let slug = slugify(name);

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    // A failed INSERT poisons the rest of the transaction until it's rolled back, so each
    // attempt gets its own savepoint — losing just this attempt, not the whole signup.
    await client.query('SAVEPOINT create_organization');
    try {
      const result = await client.query<Organization>(
        `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id, name, slug`,
        [name, slug],
      );
      await client.query('RELEASE SAVEPOINT create_organization');
      return result.rows[0]!;
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT create_organization');
      if (!isUniqueViolation(err, 'organizations_slug_key')) throw err;
      slug = `${slugify(name)}-${randomSlugSuffix()}`;
    }
  }

  throw new AppError(500, 'SLUG_GENERATION_FAILED', 'Could not generate a unique organization slug');
}

async function issueRefreshToken(
  executor: Pick<PoolClient | Pool, 'query'>,
  userId: string,
  familyId: string,
): Promise<string> {
  const token = generateRefreshToken();
  const tokenHash = hashRefreshToken(token);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await executor.query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [userId, familyId, tokenHash, expiresAt],
  );

  return token;
}

export async function signup(
  input: SignupInput,
): Promise<{ user: AuthUser; organization: Organization } & TokenPair> {
  const passwordHash = await bcrypt.hash(input.password, env.bcryptRounds);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const organization = await createOrganizationWithRetry(client, input.organizationName);

    let userRow;
    try {
      const result = await client.query<{ id: string; email: string; organization_id: string }>(
        `INSERT INTO users (organization_id, email, password_hash) VALUES ($1, $2, $3)
         RETURNING id, email, organization_id`,
        [organization.id, input.email, passwordHash],
      );
      userRow = result.rows[0]!;
    } catch (err) {
      if (isUniqueViolation(err, 'users_email_key')) {
        throw new AppError(409, 'EMAIL_TAKEN', 'Email already in use');
      }
      throw err;
    }

    const refreshToken = await issueRefreshToken(client, userRow.id, randomUUID());

    await client.query('COMMIT');

    const user: AuthUser = { id: userRow.id, email: userRow.email, organizationId: userRow.organization_id };
    const accessToken = signAccessToken({ sub: user.id, orgId: user.organizationId });

    return { user, organization, accessToken, refreshToken };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function login(input: LoginInput): Promise<{ user: AuthUser } & TokenPair> {
  const result = await pool.query<{ id: string; email: string; organization_id: string; password_hash: string }>(
    `SELECT id, email, organization_id, password_hash FROM users WHERE email = $1`,
    [input.email],
  );
  const row = result.rows[0];

  const isValid = await bcrypt.compare(input.password, row?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!row || !isValid) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const user: AuthUser = { id: row.id, email: row.email, organizationId: row.organization_id };
  const accessToken = signAccessToken({ sub: user.id, orgId: user.organizationId });
  const refreshToken = await issueRefreshToken(pool, user.id, randomUUID());

  return { user, accessToken, refreshToken };
}

interface RefreshRow {
  id: string;
  user_id: string;
  family_id: string;
  revoked_at: Date | null;
  replaced_by_token_id: string | null;
  expires_at: Date;
  organization_id: string;
}

export async function refreshSession(presentedToken: string): Promise<TokenPair> {
  const tokenHash = hashRefreshToken(presentedToken);

  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;

    // Locks the row for the transaction's duration so two concurrent refreshes with the
    // same token can't both "succeed" — the second blocks here, then sees the first
    // request's rotation once it commits and correctly hits the reuse-detected branch.
    const result = await client.query<RefreshRow>(
      `SELECT rt.id, rt.user_id, rt.family_id, rt.revoked_at, rt.replaced_by_token_id, rt.expires_at,
              u.organization_id
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1
       FOR UPDATE OF rt`,
      [tokenHash],
    );
    const row = result.rows[0];

    if (!row) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', INVALID_REFRESH_TOKEN_MESSAGE);
    }

    if (row.revoked_at) {
      if (row.replaced_by_token_id) {
        // This token was already rotated away and is being presented again -- either a
        // benign double-submit or a stolen token. Both are treated as reuse: kill the
        // whole family so every session descended from this login must re-authenticate.
        // This has to commit even though the refresh attempt itself still fails below --
        // otherwise the generic rollback in the catch block would undo the very
        // revocation this branch exists to make stick.
        await client.query(
          `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`,
          [row.family_id],
        );
        await client.query('COMMIT');
        transactionOpen = false;
      }
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', INVALID_REFRESH_TOKEN_MESSAGE);
    }

    if (row.expires_at.getTime() < Date.now()) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const newToken = generateRefreshToken();
    const newTokenHash = hashRefreshToken(newToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [row.user_id, row.family_id, newTokenHash, expiresAt],
    );
    const newRowId = insertResult.rows[0]!.id;

    await client.query(`UPDATE refresh_tokens SET revoked_at = now(), replaced_by_token_id = $1 WHERE id = $2`, [
      newRowId,
      row.id,
    ]);

    await client.query('COMMIT');
    transactionOpen = false;

    const accessToken = signAccessToken({ sub: row.user_id, orgId: row.organization_id });
    return { accessToken, refreshToken: newToken };
  } catch (err) {
    if (transactionOpen) {
      await client.query('ROLLBACK');
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function logout(presentedToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(presentedToken);
  await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [
    tokenHash,
  ]);
}
