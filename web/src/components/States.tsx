import type { ReactNode } from 'react';

/** Skeleton rows rather than a blocking spinner (UI_DESIGN.md §3). */
export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="card__body" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ marginBottom: 10, width: `${100 - i * 8}%` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <h3>{title}</h3>
      <p>{message}</p>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  // A 401 that survived the API client's refresh-and-retry means the session is genuinely
  // gone, which is a different problem from a failed request and needs different wording.
  const isAuth = 'status' in error && (error as { status: number }).status === 401;

  return (
    <div className="state state--error" role="alert">
      <h3>{isAuth ? 'Session expired' : 'Something went wrong'}</h3>
      <p>{isAuth ? 'Please sign in again to continue.' : error.message}</p>
      {onRetry && !isAuth && (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
