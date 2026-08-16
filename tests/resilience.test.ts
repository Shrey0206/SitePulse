import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { closeDb } from './helpers/db.js';

afterAll(closeDb);

describe('database pool resilience', () => {
  /**
   * Regression test for a crash that took the whole process down.
   *
   * Errors on a checked-out client reject that query's promise, so a caller's try/catch
   * handles them. But when Postgres drops a client sitting *idle* in the pool -- a
   * restart, failover, pg_terminate_backend, or a provider maintenance window -- pg emits
   * `error` on the Pool itself. An EventEmitter 'error' with no listener is rethrown by
   * Node and exits the process.
   *
   * That is the worst possible failure for a monitoring product: the checker dies silently
   * during a routine database blip, and /health (DECISIONS.md #13) becomes unreachable
   * rather than informative.
   */
  it('has an error listener registered, so an idle-client error cannot crash the process', () => {
    expect(pool.listenerCount('error')).toBeGreaterThan(0);
  });

  it('survives its pooled connections being terminated server-side', async () => {
    // Ensure at least one connection is established and returned to the pool.
    await pool.query('SELECT 1');

    // Terminate every other backend on this database, which is what a restart looks like
    // from the client's perspective.
    await pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid()`,
    );

    // Let the termination reach the idle clients. Before the fix, the unhandled 'error'
    // event fired during this window and killed the test runner outright.
    await new Promise((resolve) => setTimeout(resolve, 300));

    // The pool discards broken clients and opens fresh ones, so queries work again.
    const result = await pool.query<{ ok: number }>('SELECT 1 AS ok');
    expect(result.rows[0]?.ok).toBe(1);
  });
});
