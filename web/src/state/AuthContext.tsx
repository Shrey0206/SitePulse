import { createContext, useCallback, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { api, refreshSession, setAccessToken, setUnauthenticatedHandler } from '../lib/api';
import type { Organization, User } from '../lib/types';

interface AuthState {
  /** `restoring` is the page-load window while the silent refresh is in flight. */
  status: 'restoring' | 'authenticated' | 'anonymous';
  user: User | null;
  organization: Organization | null;
}

type AuthAction =
  | { type: 'restored'; user: User; organization: Organization | null }
  | { type: 'signed_in'; user: User; organization: Organization | null }
  | { type: 'signed_out' };

function reducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'restored':
    case 'signed_in':
      return { status: 'authenticated', user: action.user, organization: action.organization };
    case 'signed_out':
      return { status: 'anonymous', user: null, organization: null };
    default:
      return state;
  }
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, organizationName: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthResponse {
  user: User;
  organization?: Organization;
  accessToken: string;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    status: 'restoring',
    user: null,
    organization: null,
  });

  useEffect(() => {
    setUnauthenticatedHandler(() => dispatch({ type: 'signed_out' }));
  }, []);

  // The access token is memory-only (DECISIONS.md #18), so a hard refresh always starts
  // with no token. The httpOnly refresh cookie survives, so one silent refresh on load
  // restores the session -- without this the user would appear logged out on every reload.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const refreshed = await refreshSession();
      if (cancelled) return;

      if (!refreshed) {
        dispatch({ type: 'signed_out' });
        return;
      }

      try {
        // Both are fetched: the refresh cookie proves the session is valid but carries no
        // identity, so restoring has to ask who the session belongs to rather than
        // assuming. An earlier version invented a placeholder user here, which left the
        // app holding an empty id and email for the rest of the page's life.
        const [{ user }, { organization }] = await Promise.all([
          api.get<{ user: User }>('/auth/me'),
          api.get<{ organization: Organization }>('/organizations/me'),
        ]);
        if (cancelled) return;
        dispatch({ type: 'restored', user, organization });
      } catch {
        if (!cancelled) dispatch({ type: 'signed_out' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<AuthResponse>('/auth/login', { email, password });
    setAccessToken(result.accessToken);
    const { organization } = await api.get<{ organization: Organization }>('/organizations/me');
    dispatch({ type: 'signed_in', user: result.user, organization });
  }, []);

  const signup = useCallback(async (email: string, password: string, organizationName: string) => {
    const result = await api.post<AuthResponse>('/auth/signup', { email, password, organizationName });
    setAccessToken(result.accessToken);
    dispatch({ type: 'signed_in', user: result.user, organization: result.organization ?? null });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      // Cleared regardless: if the revoke call fails, the local session must still end
      // rather than leaving the user looking signed in with a dead token.
      setAccessToken(null);
      dispatch({ type: 'signed_out' });
    }
  }, []);

  const value = useMemo(
    () => ({ ...state, login, signup, logout }),
    [state, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
