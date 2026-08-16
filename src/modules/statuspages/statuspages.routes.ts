import { Router } from 'express';
import { getStatusPageHandler } from './statuspages.controller.js';

// Deliberately no requireAuth: the whole point of a status page is that it's readable
// during an outage by people who don't have accounts (DECISIONS.md, PROJECT.md §4.4).
export const statusPagesRouter = Router();

statusPagesRouter.get('/:slug', getStatusPageHandler);
