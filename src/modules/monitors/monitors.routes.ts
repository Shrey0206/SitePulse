import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import {
  createMonitorHandler,
  deleteMonitorHandler,
  getMonitorHandler,
  listMonitorsHandler,
  updateMonitorHandler,
} from './monitors.controller.js';

export const monitorsRouter = Router();

monitorsRouter.use(requireAuth);

monitorsRouter.post('/', createMonitorHandler);
monitorsRouter.get('/', listMonitorsHandler);
monitorsRouter.get('/:id', getMonitorHandler);
monitorsRouter.patch('/:id', updateMonitorHandler);
monitorsRouter.delete('/:id', deleteMonitorHandler);
