import cookieParser from 'cookie-parser';
import express from 'express';
import { pool } from './db/pool.js';
import { alertsRouter } from './modules/alerts/alerts.routes.js';
import { apiKeysRouter } from './modules/apikeys/apikeys.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { getCheckerHealth } from './modules/checker/checker.health.js';
import { incidentsRouter } from './modules/incidents/incidents.routes.js';
import { monitorsRouter } from './modules/monitors/monitors.routes.js';
import { organizationsRouter } from './modules/organizations/organizations.routes.js';
import { sseRouter } from './modules/sse/sse.routes.js';
import { statusPagesRouter } from './modules/statuspages/statuspages.routes.js';
import { errorHandler, notFoundHandler } from './shared/middlewares/errorHandler.js';
import { authRateLimiter, publicRateLimiter, sessionRateLimiter } from './shared/middlewares/rateLimit.js';

export const app = express();

// Railway (like every PaaS) puts the app behind a reverse proxy. Without this, req.ip is
// the proxy's address for every request, so the whole app shares one rate-limit bucket and
// throttles itself off almost immediately (DECISIONS.md #25). Set to 1 rather than `true`
// so only the immediate proxy is trusted -- blanket trust lets a client forge
// X-Forwarded-For and sidestep limiting entirely.
app.set('trust proxy', 1);

app.use(express.json());
app.use(cookieParser());

// Unauthenticated and cheap; deliberately outside /api/v1 so uptime probes don't break
// when the API version changes.
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

app.use('/api/v1/auth', authRateLimiter, authRouter);
app.use('/api/v1/status', publicRateLimiter, statusPagesRouter);

// sessionRateLimiter is the IP-keyed outer limit. Routers that accept API keys apply
// apiKeyRateLimiter internally, immediately after their auth middleware -- it has to run
// once req.auth exists but before the handler, so it can key off the key ID (#25).
app.use('/api/v1/organizations', sessionRateLimiter, organizationsRouter);
app.use('/api/v1/monitors', sessionRateLimiter, monitorsRouter);
app.use('/api/v1/incidents', sessionRateLimiter, incidentsRouter);
app.use('/api/v1/alerts', sessionRateLimiter, alertsRouter);
app.use('/api/v1/keys', sessionRateLimiter, apiKeysRouter);
app.use('/api/v1/sse', sessionRateLimiter, sseRouter);

app.use(notFoundHandler);
app.use(errorHandler);
