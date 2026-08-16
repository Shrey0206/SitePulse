import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../../config/env.js';

// In-memory store, consistent with the single-instance monolith in DECISIONS.md #4/#5 --
// a Redis-backed store buys cross-instance consistency this deployment has no need for
// (#25). Known limitation, stated rather than hidden: limits reset on restart and would
// not hold across multiple instances.
const shared: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Disabled under test: 100 requests of headroom is meaningless when a suite fires
  // hundreds of requests from one address in seconds.
  skip: () => env.nodeEnv === 'test',
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
    });
  },
};

/** Tight limit on unauthenticated auth endpoints -- these are the credential-guessing surface. */
export const authRateLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 20,
});

/** General session traffic, keyed by IP (the only stable identifier before auth). */
export const sessionRateLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 120,
});

/**
 * Programmatic traffic, keyed by API key ID rather than IP (#25). For an API client the
 * real caller identity is the key: several servers behind one NAT would otherwise share a
 * bucket, and one noisy client could throttle everyone behind the same address.
 */
export const apiKeyRateLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 600,
  keyGenerator: (req: Request) => req.auth?.apiKeyId ?? req.ip ?? 'unknown',
  // Only applies to key-authenticated requests; session traffic is covered above.
  skip: (req: Request) => env.nodeEnv === 'test' || req.auth?.method !== 'api_key',
});

/** Public status pages are unauthenticated and get hit hardest during an outage. */
export const publicRateLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 300,
});
