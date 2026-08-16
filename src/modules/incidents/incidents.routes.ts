import { Router } from 'express';
import { apiKeyRateLimiter } from '../../shared/middlewares/rateLimit.js';
import { requireAuthOrApiKey } from '../auth/auth.middleware.js';
import {
  createIncidentHandler,
  deleteIncidentHandler,
  getIncidentHandler,
  listIncidentsHandler,
  resolveIncidentHandler,
  updateIncidentHandler,
} from './incidents.controller.js';

export const incidentsRouter = Router();

incidentsRouter.use(requireAuthOrApiKey);
incidentsRouter.use(apiKeyRateLimiter);

incidentsRouter.post('/', createIncidentHandler);
incidentsRouter.get('/', listIncidentsHandler);
incidentsRouter.get('/:id', getIncidentHandler);
incidentsRouter.patch('/:id', updateIncidentHandler);
incidentsRouter.post('/:id/resolve', resolveIncidentHandler);
incidentsRouter.delete('/:id', deleteIncidentHandler);
