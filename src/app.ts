import cookieParser from 'cookie-parser';
import express from 'express';
import { pool } from './db/pool.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { getCheckerHealth } from './modules/checker/checker.health.js';
import { incidentsRouter } from './modules/incidents/incidents.routes.js';
import { monitorsRouter } from './modules/monitors/monitors.routes.js';
import { organizationsRouter } from './modules/organizations/organizations.routes.js';
import { errorHandler, notFoundHandler } from './shared/middlewares/errorHandler.js';

export const app = express();

app.use(express.json());
app.use(cookieParser());

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
  } catch {
    // The DB itself is unreachable -- a hard failure, distinct from the checker merely
    // running stale, so this is the one case that gets a non-2xx status.
    res.status(503).json({ status: 'error', database: 'error' });
    return;
  }

  const checker = await getCheckerHealth();
  res.status(200).json({ status: checker.status, database: 'ok', checker });
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/organizations', organizationsRouter);
app.use('/api/v1/monitors', monitorsRouter);
app.use('/api/v1/incidents', incidentsRouter);

app.use(notFoundHandler);
app.use(errorHandler);
