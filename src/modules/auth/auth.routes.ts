import { Router } from 'express';
import { loginHandler, logoutHandler, refreshHandler, signupHandler } from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/signup', signupHandler);
authRouter.post('/login', loginHandler);
authRouter.post('/refresh', refreshHandler);
authRouter.post('/logout', logoutHandler);
