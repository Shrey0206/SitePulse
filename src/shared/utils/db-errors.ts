const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

interface PgError {
  code?: string;
  constraint?: string;
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const pgError = err as PgError;
  if (pgError?.code !== UNIQUE_VIOLATION) return false;
  return constraint ? pgError.constraint === constraint : true;
}

export function isCheckViolation(err: unknown, constraint?: string): boolean {
  const pgError = err as PgError;
  if (pgError?.code !== CHECK_VIOLATION) return false;
  return constraint ? pgError.constraint === constraint : true;
}
