export interface AuthContext {
  /** Absent for API-key auth: a key belongs to an organization, not to a person. */
  userId?: string;
  orgId: string;
  /** Which credential authenticated this request -- drives rate-limit keying (#25). */
  method: 'jwt' | 'api_key';
  /** Set only for API-key auth; the rate-limit bucket keys off it. */
  apiKeyId?: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
