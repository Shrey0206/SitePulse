import type { Request } from 'express';
import { AppError } from '../errors/AppError.js';

export function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', `Missing route parameter: ${name}`);
  }
  return value;
}
