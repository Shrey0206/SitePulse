import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { createTicketHandler, streamHandler } from './sse.controller.js';

export const sseRouter = Router();

// EventSource can't send an Authorization header, so the stream itself can't use the
// header-only access token from DECISIONS.md #18. The client authenticates here with a
// normal Bearer token to mint a short-lived single-use ticket, then connects with that
// (#27) -- keeping the real credential out of both the URL and any long-lived cookie.
sseRouter.post('/ticket', requireAuth, createTicketHandler);
sseRouter.get('/', streamHandler);
