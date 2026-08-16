import { Pool } from 'pg';
import { env } from '../config/env.js';

export const pool = new Pool({
  connectionString: env.databaseUrl,
  // Bounded so a burst of concurrent checks can't open unlimited connections against a
  // Postgres that has its own connection limit.
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

/**
 * Without this listener the process exits on any error affecting an *idle* pooled client.
 *
 * Errors on a client that's currently checked out reject that query's promise, so the
 * caller's try/catch handles them. But when Postgres drops a connection sitting idle in
 * the pool -- a restart, a failover, `pg_terminate_backend`, an idle-timeout on the server
 * side, or a cloud provider's routine maintenance -- node-postgres emits `error` on the
 * Pool itself. An EventEmitter 'error' event with no listener is rethrown by Node and
 * takes the process down.
 *
 * This crashed the dev server when Postgres was stopped underneath it
 * ("terminating connection due to administrator command"). On Railway the same thing
 * happens on any database maintenance window, which is exactly the failure mode a
 * monitoring product cannot have: the checker dying silently while the thing it exists to
 * watch is fine. DECISIONS.md #13 added /health to answer "how do you know your own system
 * is working" -- a process that exits on a database blip makes that endpoint unreachable
 * rather than informative.
 *
 * Logging and continuing is correct here: the pool discards the broken client and opens a
 * fresh one on the next query, so the error is recoverable and callers see it as a normal
 * failed query.
 */
pool.on('error', (err) => {
  console.error('Postgres pool error (idle client dropped, pool will reconnect):', err.message);
});

/**
 * Closes the pool on shutdown so in-flight queries finish and Postgres isn't left holding
 * connections. Railway sends SIGTERM on every deploy, so this runs routinely rather than
 * only in emergencies.
 */
export async function closePool(): Promise<void> {
  await pool.end();
}
