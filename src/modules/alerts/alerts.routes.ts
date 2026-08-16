import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  createChannelHandler,
  deleteChannelHandler,
  listChannelsHandler,
  listDeliveriesHandler,
  updateChannelHandler,
} from './alerts.controller.js';

export const alertsRouter = Router();

alertsRouter.use(requireAuth);

alertsRouter.post('/channels', createChannelHandler);
alertsRouter.get('/channels', listChannelsHandler);
alertsRouter.patch('/channels/:id', updateChannelHandler);
alertsRouter.delete('/channels/:id', deleteChannelHandler);

// Backs the Alert Settings page's "did the alert actually send, and if not why" view.
alertsRouter.get('/deliveries', listDeliveriesHandler);
