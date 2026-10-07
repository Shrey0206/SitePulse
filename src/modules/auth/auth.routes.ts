import { Router } from 'express';
import { authRateLimiter, sessionRateLimiter } from '../../shared/middlewares/rateLimit.js';
import { loginHandler, logoutHandler, meHandler, refreshHandler, signupHandler } from './auth.controller.js';
import { requireAuth } from './auth.middleware.js';

export const authRouter = Router();

// Credential endpoints get the tight limiter: they are the password-guessing surface.
authRouter.post('/signup', authRateLimiter, signupHandler);
authRouter.post('/login', authRateLimiter, loginHandler);

// Session upkeep gets the ordinary session limiter. The frontend calls refresh and then /me on
// every page load, so putting these under the 20-per-15-minutes credential limit locked a user
// out (and logged them out) after about ten reloads. Neither is a guessing target: refresh needs
// a valid unguessable refresh token and /me needs a valid access token.
authRouter.post('/refresh', sessionRateLimiter, refreshHandler);
authRouter.post('/logout', sessionRateLimiter, logoutHandler);

// Session-only: an API key belongs to an organization, not a person, so there is no
// "current user" to return for one.
authRouter.get('/me', sessionRateLimiter, requireAuth, meHandler);
