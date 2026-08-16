import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../shared/errors/AppError.js';
import { verifyApiKey } from '../apikeys/apikeys.service.js';
import { verifyAccessToken } from './auth.tokens.js';

const BEARER_PREFIX = 'Bearer ';
const API_KEY_HEADER = 'x-api-key';

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');
  if (!header?.startsWith(BEARER_PREFIX)) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Missing or invalid Authorization header');
  }

  const token = header.slice(BEARER_PREFIX.length);
  try {
    const payload = verifyAccessToken(token);
    req.auth = { userId: payload.sub, orgId: payload.orgId, method: 'jwt' };
    next();
  } catch {
    throw new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired access token');
  }
}

/**
 * Accepts either a session JWT or a programmatic API key, for endpoints exposed to both a
 * logged-in dashboard and third-party API clients.
 *
 * API keys are read from X-API-Key rather than Authorization: keeping them in separate
 * headers means the two credential types can never be confused for one another, and a
 * client can't accidentally send a key where a token is expected.
 */
export async function requireAuthOrApiKey(req: Request, _res: Response, next: NextFunction) {
  const apiKey = req.header(API_KEY_HEADER);

  if (apiKey) {
    const verified = await verifyApiKey(apiKey);
    if (!verified) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Invalid or revoked API key');
    }
    // No userId: a key belongs to an organization, not a person. v1 keys are full-access
    // within their org and never expire until revoked (DECISIONS.md #37).
    req.auth = { orgId: verified.organizationId, method: 'api_key', apiKeyId: verified.id };
    next();
    return;
  }

  requireAuth(req, _res, next);
}
