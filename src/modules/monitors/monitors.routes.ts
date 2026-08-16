import { Router } from 'express';
import { apiKeyRateLimiter } from '../../shared/middlewares/rateLimit.js';
import { requireAuthOrApiKey } from '../auth/auth.middleware.js';
import {
  createMonitorHandler,
  deleteMonitorHandler,
  getMonitorHandler,
  listMonitorsHandler,
  updateMonitorHandler,
} from './monitors.controller.js';

export const monitorsRouter = Router();

// Exposed to both the dashboard (JWT) and third-party API clients (API key). The
// key-keyed limiter runs straight after auth, once req.auth identifies which credential
// was used.
monitorsRouter.use(requireAuthOrApiKey);
monitorsRouter.use(apiKeyRateLimiter);

monitorsRouter.post('/', createMonitorHandler);
monitorsRouter.get('/', listMonitorsHandler);
monitorsRouter.get('/:id', getMonitorHandler);
monitorsRouter.patch('/:id', updateMonitorHandler);
monitorsRouter.delete('/:id', deleteMonitorHandler);
