import type { Request, Response } from 'express';
import { loginSchema, signupSchema } from './auth.schemas.js';
import * as authService from './auth.service.js';

export async function signupHandler(req: Request, res: Response) {
  const input = signupSchema.parse(req.body);
  const result = await authService.signup(input);
  res.status(201).json({ success: true, data: result });
}

export async function loginHandler(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  const result = await authService.login(input);
  res.status(200).json({ success: true, data: result });
}
