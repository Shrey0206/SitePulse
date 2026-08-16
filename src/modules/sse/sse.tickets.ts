import { randomBytes } from 'node:crypto';

interface Ticket {
  userId: string;
  orgId: string;
  expiresAt: number;
}

const TICKET_TTL_MS = 30_000;
const SWEEP_INTERVAL_MS = 60_000;

// In-memory, consistent with the no-new-infrastructure pattern used throughout
// (DECISIONS.md #27). Known limitation, same as the rate limiter in #25: tickets don't
// survive a restart and wouldn't be shared across instances. Both are harmless here --
// a lost ticket just means the client mints another one on its next reconnect.
const tickets = new Map<string, Ticket>();

export function issueTicket(userId: string, orgId: string): { ticket: string; expiresIn: number } {
  const ticket = randomBytes(32).toString('base64url');
  tickets.set(ticket, { userId, orgId, expiresAt: Date.now() + TICKET_TTL_MS });
  return { ticket, expiresIn: Math.floor(TICKET_TTL_MS / 1000) };
}

/**
 * Single-use by construction: the ticket is deleted on the first successful lookup, so a
 * replay -- including one from a leaked server access log -- finds nothing. Combined with
 * the 30s TTL, a leaked ticket is worthless almost immediately.
 */
export function consumeTicket(ticket: string): { userId: string; orgId: string } | null {
  const entry = tickets.get(ticket);
  if (!entry) return null;

  tickets.delete(ticket);
  if (entry.expiresAt < Date.now()) return null;

  return { userId: entry.userId, orgId: entry.orgId };
}

// Expired tickets are rejected on lookup regardless; this only stops unclaimed ones
// accumulating in a long-running process.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [ticket, entry] of tickets) {
    if (entry.expiresAt < now) tickets.delete(ticket);
  }
}, SWEEP_INTERVAL_MS);
sweeper.unref();

export function _resetTicketsForTests(): void {
  tickets.clear();
}
