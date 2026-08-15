import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { loginSchema, signupSchema } from './auth.schemas.js';
import * as authService from './auth.service.js';
import { REFRESH_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_PATH, REFRESH_TOKEN_TTL_MS } from './auth.tokens.js';

const REFRESH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: env.nodeEnv === 'production',
  sameSite: 'strict',
  path: REFRESH_TOKEN_COOKIE_PATH,
};

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, token, { ...REFRESH_COOKIE_OPTIONS, maxAge: REFRESH_TOKEN_TTL_MS });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, REFRESH_COOKIE_OPTIONS);
}

export async function signupHandler(req: Request, res: Response) {
  const input = signupSchema.parse(req.body);
  const { user, organization, accessToken, refreshToken } = await authService.signup(input);
  setRefreshCookie(res, refreshToken);
  res.status(201).json({ success: true, data: { user, organization, accessToken } });
}

export async function loginHandler(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  const { user, accessToken, refreshToken } = await authService.login(input);
  setRefreshCookie(res, refreshToken);
  res.status(200).json({ success: true, data: { user, accessToken } });
}

export async function refreshHandler(req: Request, res: Response) {
  const presentedToken: unknown = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
  if (typeof presentedToken !== 'string') {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');
  }

  try {
    const { accessToken, refreshToken } = await authService.refreshSession(presentedToken);
    setRefreshCookie(res, refreshToken);
    res.status(200).json({ success: true, data: { accessToken } });
  } catch (err) {
    clearRefreshCookie(res);
    throw err;
  }
}

export async function logoutHandler(req: Request, res: Response) {
  const presentedToken: unknown = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
  if (typeof presentedToken === 'string') {
    await authService.logout(presentedToken);
  }
  clearRefreshCookie(res);
  res.status(200).json({ success: true, data: null });
}
