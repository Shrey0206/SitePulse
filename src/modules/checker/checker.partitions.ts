import { pool } from '../../db/pool.js';

const LOOKAHEAD_MONTHS = 2;

function monthStart(date: Date, offsetMonths: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offsetMonths, 1));
}

function partitionName(monthStartDate: Date): string {
  const year = monthStartDate.getUTCFullYear();
  const month = String(monthStartDate.getUTCMonth() + 1).padStart(2, '0');
  return `checks_${year}_${month}`;
}

function boundLiteral(monthStartDate: Date): string {
  return monthStartDate.toISOString().slice(0, 10);
}

// Native declarative RANGE partitioning never auto-creates partitions -- an insert whose
// checked_at falls outside every existing partition's range fails outright. This runs at
// process startup and once daily so the checker's own writes never hit that gap
// (DECISIONS.md #32). Idempotent: IF NOT EXISTS makes re-running it a no-op.
export async function ensureChecksPartitions(now = new Date()): Promise<void> {
  for (let offset = 0; offset <= LOOKAHEAD_MONTHS; offset++) {
    const start = monthStart(now, offset);
    const end = monthStart(now, offset + 1);

    const name = partitionName(start);
    const from = boundLiteral(start);
    const to = boundLiteral(end);

    // Postgres allows no bind parameters anywhere in DDL -- not for the table identifier
    // and not for the FOR VALUES bounds either -- so all three have to be interpolated.
    // Every one is derived from a Date this function constructed, never from user input,
    // and the shape of each is asserted below so a future change can't quietly turn this
    // into an injection point.
    if (!/^checks_\d{4}_\d{2}$/.test(name)) {
      throw new Error(`Refusing to create partition with unexpected name: ${name}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new Error(`Refusing to create partition with unexpected bounds: ${from}..${to}`);
    }

    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF checks FOR VALUES FROM ('${from}') TO ('${to}')`,
    );
  }
}
