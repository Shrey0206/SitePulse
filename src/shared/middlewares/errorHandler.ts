import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError.js';

export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction) {
  // A response that has already started cannot be turned into a JSON error -- writing a
  // status onto it throws ERR_HTTP_HEADERS_SENT, which would escape this handler as an
  // unhandled error. Reachable through SSE, which flushes headers the moment a stream
  // opens. Express's default handler destroys the socket, which is the only honest
  // outcome once a partial response is on the wire.
  if (res.headersSent) {
    console.error('Error after response started; aborting connection:', err);
    next(err);
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.issues },
    });
    return;
  }

  console.error(err);
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
}
