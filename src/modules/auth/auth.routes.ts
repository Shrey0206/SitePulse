import { Router } from 'express';
import { loginHandler, signupHandler } from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/signup', signupHandler);
authRouter.post('/login', loginHandler);
