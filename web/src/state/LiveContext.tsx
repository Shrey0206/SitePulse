import { createContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { api } from '../lib/api';
import type { MonitorStatus } from '../lib/types';

export type ConnectionState = 'connecting' | 'open' | 'disconnected';

interface LiveState {
  connection: ConnectionState;
  /** Live status overrides, keyed by monitor id, layered over the last fetched list. */
  statuses: Record<string, MonitorStatus>;
  /** Bumped whenever an incident opens or resolves, so pages can refetch. */
  incidentVersion: number;
}

type LiveAction =
  | { type: 'connection'; state: ConnectionState }
  | { type: 'status'; monitorId: string; status: MonitorStatus }
  | { type: 'incident_changed' }
  | { type: 'reset' };

function reducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case 'connection':
      return { ...state, connection: action.state };
    case 'status':
      return { ...state, statuses: { ...state.statuses, [action.monitorId]: action.status } };
    case 'incident_changed':
      return { ...state, incidentVersion: state.incidentVersion + 1 };
    case 'reset':
      return { connection: 'connecting', statuses: {}, incidentVersion: 0 };
    default:
      return state;
  }
}

export const LiveContext = createContext<LiveState | null>(null);

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

export function LiveProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    connection: 'connecting',
    statuses: {},
    incidentVersion: 0,
  });

  const sourceRef = useRef<EventSource | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const attemptsRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      dispatch({ type: 'reset' });
      return;
    }

    let cancelled = false;

    const cleanup = () => {
      sourceRef.current?.close();
      sourceRef.current = null;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      // Backoff exists to protect the server: if it's down, every open dashboard would
      // otherwise retry in lockstep every second and keep it down.
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attemptsRef.current, RECONNECT_MAX_MS);
      attemptsRef.current += 1;
      retryTimerRef.current = window.setTimeout(connect, delay);
    };

    const connect = async () => {
      if (cancelled) return;
      dispatch({ type: 'connection', state: attemptsRef.current === 0 ? 'connecting' : 'disconnected' });

      let ticket: string;
      try {
        // A fresh ticket per connection. The browser's native EventSource retry would
        // reopen the same URL with a ticket that is single-use and already spent, so
        // reconnection has to re-mint rather than rely on it (UI_TECH_DECISIONS.md #4).
        const result = await api.post<{ ticket: string }>('/sse/ticket');
        ticket = result.ticket;
      } catch {
        dispatch({ type: 'connection', state: 'disconnected' });
        scheduleReconnect();
        return;
      }

      if (cancelled) return;

      const source = new EventSource(`/api/v1/sse?ticket=${encodeURIComponent(ticket)}`);
      sourceRef.current = source;

      source.addEventListener('connected', () => {
        attemptsRef.current = 0;
        dispatch({ type: 'connection', state: 'open' });
      });

      source.addEventListener('monitor_status_changed', (event) => {
        const data = JSON.parse((event as MessageEvent<string>).data) as {
          monitorId: string;
          status: MonitorStatus;
        };
        dispatch({ type: 'status', monitorId: data.monitorId, status: data.status });
      });

      const onIncident = () => dispatch({ type: 'incident_changed' });
      source.addEventListener('incident_opened', onIncident);
      source.addEventListener('incident_resolved', onIncident);

      // The server closes each connection after ~15 minutes and sends this first
      // (DECISIONS.md #35). Treated as a normal cycle, not a failure: reconnect
      // immediately rather than showing the user a disconnected banner for a planned close.
      source.addEventListener('reconnect', () => {
        source.close();
        sourceRef.current = null;
        attemptsRef.current = 0;
        if (!cancelled) void connect();
      });

      source.onerror = () => {
        source.close();
        sourceRef.current = null;
        dispatch({ type: 'connection', state: 'disconnected' });
        scheduleReconnect();
      };
    };

    void connect();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [enabled]);

  const value = useMemo(() => state, [state]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
