import bcrypt from 'bcrypt';
import type { PoolClient } from 'pg';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { AppError } from '../../shared/errors/AppError.js';
import { isUniqueViolation } from '../../shared/utils/db-errors.js';
import { randomSlugSuffix, slugify } from '../../shared/utils/slug.js';
import type { LoginInput, SignupInput } from './auth.schemas.js';
import { signAccessToken } from './auth.tokens.js';

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

const MAX_SLUG_ATTEMPTS = 5;

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

export async function signup(
  input: SignupInput,
): Promise<{ user: AuthUser; organization: Organization; accessToken: string }> {
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

    await client.query('COMMIT');

    const user: AuthUser = { id: userRow.id, email: userRow.email, organizationId: userRow.organization_id };
    const accessToken = signAccessToken({ sub: user.id, orgId: user.organizationId });

    return { user, organization, accessToken };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function login(input: LoginInput): Promise<{ user: AuthUser; accessToken: string }> {
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

  return { user, accessToken };
}
