import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { getMyOrganizationHandler } from './organizations.controller.js';

export const organizationsRouter = Router();

organizationsRouter.get('/me', requireAuth, getMyOrganizationHandler);
