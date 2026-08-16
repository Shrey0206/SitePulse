import { app } from './app.js';
import { env } from './config/env.js';
import { closePool } from './db/pool.js';
import { startScheduler, stopScheduler } from './modules/checker/checker.scheduler.js';
import { closeAllConnections } from './modules/sse/sse.hub.js';

const server = app.listen(env.port, () => {
  console.log(`SitePulse listening on port ${env.port}`);
});

// Not awaited: the API shouldn't wait on the first check cycle to start accepting
// requests. startScheduler() never rejects (see checker.scheduler.ts), but `void` makes
// the "fire and forget, and that's deliberate" explicit rather than looking like an
// oversight.
void startScheduler();

/**
 * Railway sends SIGTERM on every deploy, so this is a routine path rather than an
 * emergency one. Without it the process is killed with SSE streams still open and pool
 * connections still checked out, which Postgres then has to time out on its own.
 *
 * In-flight checks are still lost on shutdown -- that limitation is inherent to the
 * no-queue design and is stated in DECISIONS.md #4. Persisted state-machine counters (#19)
 * are what stop that from losing outage-detection progress across a restart.
 */
let shuttingDown = false;

function shutdown(signal: string): void {
  // A second signal during shutdown means someone is impatient; honour it immediately
  // rather than appearing hung.
  if (shuttingDown) {
    process.exit(1);
  }
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);

  stopScheduler();
  closeAllConnections();

  server.close(() => {
    void closePool()
      .catch((err: unknown) => console.error('Error closing database pool:', err))
      .finally(() => process.exit(0));
  });

  // Long-lived SSE connections mean server.close() can wait indefinitely on sockets that
  // are working exactly as designed, so cap the wait rather than hanging a deploy.
  setTimeout(() => {
    console.error('Shutdown timed out, exiting');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
