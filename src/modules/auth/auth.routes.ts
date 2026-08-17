import { Router } from 'express';
import { loginHandler, logoutHandler, meHandler, refreshHandler, signupHandler } from './auth.controller.js';
import { requireAuth } from './auth.middleware.js';

export const authRouter = Router();

authRouter.post('/signup', signupHandler);
authRouter.post('/login', loginHandler);
authRouter.post('/refresh', refreshHandler);
authRouter.post('/logout', logoutHandler);

// Session-only: an API key belongs to an organization, not a person, so there is no
// "current user" to return for one.
authRouter.get('/me', requireAuth, meHandler);
