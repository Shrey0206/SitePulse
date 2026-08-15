import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../shared/errors/AppError.js';
import { verifyAccessToken } from './auth.tokens.js';

const BEARER_PREFIX = 'Bearer ';

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');
  if (!header?.startsWith(BEARER_PREFIX)) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Missing or invalid Authorization header');
  }

  const token = header.slice(BEARER_PREFIX.length);
  try {
    const payload = verifyAccessToken(token);
    req.auth = { userId: payload.sub, orgId: payload.orgId };
    next();
  } catch {
    throw new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired access token');
  }
}
