import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

export interface AccessTokenPayload {
  sub: string;
  orgId: string;
}

const ACCESS_TOKEN_TTL = '15m';

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtSecret) as AccessTokenPayload;
}

// Refresh tokens are opaque random values, not JWTs -- only a hash is ever stored,
// so a leaked DB row can't be replayed as a token (DECISIONS.md #6, #31).
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REFRESH_TOKEN_COOKIE_NAME = 'refreshToken';
// Scoped to /api/v1/auth rather than site-wide, so it's never attached to
// business-data requests (monitors, organizations, etc.) -- see DECISIONS.md #18.
export const REFRESH_TOKEN_COOKIE_PATH = '/api/v1/auth';

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
