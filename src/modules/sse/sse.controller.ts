import type { Request, Response } from 'express';
import { AppError } from '../../shared/errors/AppError.js';
import { addConnection } from './sse.hub.js';
import { consumeTicket, issueTicket } from './sse.tickets.js';

export function createTicketHandler(req: Request, res: Response) {
  const { userId, orgId } = req.auth!;

  // The route is mounted behind requireAuth (JWT only), so userId is always present. The
  // guard makes that a checked precondition rather than an assumption: a live dashboard
  // stream belongs to a person, not to a programmatic API key.
  if (!userId) {
    throw new AppError(403, 'FORBIDDEN', 'SSE streams require a user session, not an API key');
  }

  const { ticket, expiresIn } = issueTicket(userId, orgId);
  res.status(201).json({ success: true, data: { ticket, expiresIn } });
}

export function streamHandler(req: Request, res: Response) {
  const ticket = req.query.ticket;
  if (typeof ticket !== 'string') {
    throw new AppError(401, 'INVALID_TICKET', 'Missing SSE ticket');
  }

  const session = consumeTicket(ticket);
  if (!session) {
    throw new AppError(401, 'INVALID_TICKET', 'SSE ticket is invalid, expired, or already used');
  }

  const cleanup = addConnection(res, session.orgId);
  req.on('close', cleanup);
}
