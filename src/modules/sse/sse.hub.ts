import type { Response } from 'express';

export interface SseEvent {
  type: 'monitor_status_changed' | 'incident_opened' | 'incident_resolved';
  data: Record<string, unknown>;
}

interface Connection {
  id: number;
  orgId: string;
  res: Response;
  closeTimer: NodeJS.Timeout;
  heartbeat: NodeJS.Timeout;
}

// Matches the access-token TTL (DECISIONS.md #6, #35). The ticket authenticates only at
// connect time, so without this an already-open stream would outlive a logout
// indefinitely. Reconnecting requires a fresh ticket, which requires a valid access token
// -- so a logged-out client provably stops receiving within one window.
const MAX_CONNECTION_MS = 15 * 60 * 1000;
const HEARTBEAT_MS = 25_000;

const connections = new Map<number, Connection>();
let nextConnectionId = 1;

function write(res: Response, payload: string): void {
  // A client that vanished without a close event makes this throw; there's nothing useful
  // to do but drop the connection, which the close handler already does.
  try {
    res.write(payload);
  } catch {
    /* ignore */
  }
}

export function addConnection(res: Response, orgId: string): () => void {
  const id = nextConnectionId++;

  // Proxies buffer by default, which would hold events until the buffer fills -- fatal for
  // a stream whose whole purpose is immediacy. X-Accel-Buffering opts nginx-style proxies
  // out explicitly.
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  write(res, `retry: 3000\n\n`);
  write(res, `event: connected\ndata: ${JSON.stringify({ orgId })}\n\n`);

  const heartbeat = setInterval(() => {
    // Comment frames keep intermediaries from treating an idle stream as dead.
    write(res, `: heartbeat\n\n`);
  }, HEARTBEAT_MS);

  const teardown = () => {
    const connection = connections.get(id);
    if (!connection) return;
    clearInterval(connection.heartbeat);
    clearTimeout(connection.closeTimer);
    connections.delete(id);
  };

  const closeTimer = setTimeout(() => {
    write(res, `event: reconnect\ndata: ${JSON.stringify({ reason: 'max_connection_age' })}\n\n`);
    res.end();
    // Torn down here rather than waiting for the client's close event. That event normally
    // follows res.end(), but a half-open socket may never deliver it -- and until it does,
    // the heartbeat keeps firing every 25s against a dead response and the entry stays in
    // the fan-out map.
    teardown();
  }, MAX_CONNECTION_MS);

  connections.set(id, { id, orgId, res, closeTimer, heartbeat });

  // Idempotent: whichever of client-disconnect or max-age fires first wins, and the second
  // is a no-op because the entry is already gone.
  return teardown;
}

/** Fan-out is org-scoped: a connection only ever receives its own tenant's events. */
export function broadcastToOrg(orgId: string, event: SseEvent): void {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
  for (const connection of connections.values()) {
    if (connection.orgId === orgId) write(connection.res, payload);
  }
}

export function getConnectionCount(orgId?: string): number {
  if (!orgId) return connections.size;
  let count = 0;
  for (const connection of connections.values()) {
    if (connection.orgId === orgId) count++;
  }
  return count;
}

export function closeAllConnections(): void {
  for (const connection of connections.values()) {
    clearInterval(connection.heartbeat);
    clearTimeout(connection.closeTimer);
    connection.res.end();
  }
  connections.clear();
}
