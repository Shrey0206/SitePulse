/**
 * Typed wrapper over fetch. Native fetch rather than Axios (UI_TECH_DECISIONS.md #5) --
 * the wrapper is small enough to read in one sitting and explain in full.
 *
 * The access token lives in memory only, never localStorage (DECISIONS.md #18), so it is
 * held here in a module variable rather than any persistent store. A hard refresh loses
 * it, which is exactly why the app calls refresh() on load.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let accessToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Lets the auth provider clear session state when a refresh attempt fails for good. */
export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

async function parseError(response: Response): Promise<ApiError> {
  let code = 'UNKNOWN';
  let message = response.statusText || 'Request failed';
  try {
    const body = (await response.json()) as ApiEnvelope<unknown>;
    if (body.error) {
      code = body.error.code;
      message = body.error.message;
    }
  } catch {
    /* non-JSON error body; keep the status-derived message */
  }
  return new ApiError(response.status, code, message);
}

async function rawRequest(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  return fetch(`/api/v1${path}`, {
    ...init,
    headers,
    // Needed for the refresh endpoint's httpOnly cookie. Same-origin in both dev (Vite
    // proxy) and production (Express serves the build), so the cookie stays first-party.
    credentials: 'same-origin',
  });
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Refreshes the access token. Concurrent callers share one in-flight request: several
 * requests 401-ing at once (a dashboard loads monitors and incidents together) would
 * otherwise each rotate the refresh token, and rotation makes every rotation after the
 * first look like token reuse -- which the server treats as theft and responds to by
 * revoking the whole family, logging the user out (DECISIONS.md #31).
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) return false;

      const body = (await response.json()) as ApiEnvelope<{ accessToken: string }>;
      accessToken = body.data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function request<T>(path: string, init: RequestInit = {}, allowRetry = true): Promise<T> {
  const response = await rawRequest(path, init);

  if (response.status === 401 && allowRetry) {
    // One retry only. If the refreshed token also 401s, the session is genuinely gone and
    // retrying again would loop.
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(path, init, false);

    accessToken = null;
    onUnauthenticated?.();
    throw await parseError(response);
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;

  const body = (await response.json()) as ApiEnvelope<T>;
  return body.data;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Public status pages are unauthenticated, so they bypass the token/refresh machinery. */
export async function fetchPublic<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`);
  if (!response.ok) throw await parseError(response);
  const body = (await response.json()) as ApiEnvelope<T>;
  return body.data;
}
