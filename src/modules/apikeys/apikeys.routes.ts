import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { createApiKeyHandler, listApiKeysHandler, revokeApiKeyHandler } from './apikeys.controller.js';

export const apiKeysRouter = Router();

// requireAuth, not requireAuthOrApiKey: managing keys is a session-only operation, so a
// leaked key can't be used to mint further keys and entrench itself.
apiKeysRouter.use(requireAuth);

apiKeysRouter.post('/', createApiKeyHandler);
apiKeysRouter.get('/', listApiKeysHandler);
apiKeysRouter.delete('/:id', revokeApiKeyHandler);
