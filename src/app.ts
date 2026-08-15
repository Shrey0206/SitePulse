import cookieParser from 'cookie-parser';
import express from 'express';
import { pool } from './db/pool.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { monitorsRouter } from './modules/monitors/monitors.routes.js';
import { organizationsRouter } from './modules/organizations/organizations.routes.js';
import { errorHandler, notFoundHandler } from './shared/middlewares/errorHandler.js';

export const app = express();

app.use(express.json());
app.use(cookieParser());

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'error', reason: 'database unreachable' });
  }
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/organizations', organizationsRouter);
app.use('/api/v1/monitors', monitorsRouter);

app.use(notFoundHandler);
app.use(errorHandler);
