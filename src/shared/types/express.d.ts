export interface AuthContext {
  userId: string;
  orgId: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
