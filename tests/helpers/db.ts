import { pool } from '../../src/db/pool.js';

export async function resetDb(): Promise<void> {
  await pool.query(
    'TRUNCATE refresh_tokens, checks, incidents, monitors, users, organizations RESTART IDENTITY CASCADE',
  );
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
