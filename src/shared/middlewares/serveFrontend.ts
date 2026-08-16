import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/shared/middlewares -> project root -> web/dist
const FRONTEND_DIR = path.resolve(here, '../../../web/dist');

/**
 * Serves the built frontend from the API process itself.
 *
 * Single-origin serving is what keeps the refresh cookie first-party without SameSite=None
 * and a CSRF-token scheme (DECISIONS.md #18). In dev the Vite server proxies to Express for
 * the same reason, so both environments have identical cookie behaviour.
 *
 * No-op when the build is absent -- running the API without building the frontend (tests,
 * a backend-only dev loop) should not crash on a missing directory.
 */
export function serveFrontend(app: Express): void {
  if (!existsSync(FRONTEND_DIR)) return;

  // Hashed asset filenames are safe to cache hard; index.html must not be, or a deploy
  // leaves clients loading an old shell that references assets which no longer exist.
  app.use(
    express.static(FRONTEND_DIR, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  // SPA fallback: client-side routes like /dashboard/monitors and /status/:slug have no
  // file on disk. Mounted after every API router, so an unmatched /api/v1 path still gets
  // a JSON 404 rather than the HTML shell -- an API client receiving HTML for a typo is a
  // genuinely confusing failure.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
}
