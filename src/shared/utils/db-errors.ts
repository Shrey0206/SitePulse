const UNIQUE_VIOLATION = '23505';

interface PgError {
  code?: string;
  constraint?: string;
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const pgError = err as PgError;
  if (pgError?.code !== UNIQUE_VIOLATION) return false;
  return constraint ? pgError.constraint === constraint : true;
}
