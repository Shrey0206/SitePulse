import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireParam } from '../../shared/utils/params.js';
import * as apiKeysService from './apikeys.service.js';

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export async function createApiKeyHandler(req: Request, res: Response) {
  const input = createApiKeySchema.parse(req.body);
  const { apiKey, key } = await apiKeysService.createApiKey(req.auth!.orgId, input.name);

  // Shown exactly once, at creation -- only the SHA-256 hash is stored, so it cannot be
  // recovered or re-displayed afterwards (DECISIONS.md #29).
  res.status(201).json({
    success: true,
    data: {
      apiKey,
      key,
      keyNotice: 'Store this key now -- it will not be shown again.',
    },
  });
}

export async function listApiKeysHandler(req: Request, res: Response) {
  const apiKeys = await apiKeysService.listApiKeys(req.auth!.orgId);
  res.status(200).json({ success: true, data: { apiKeys } });
}

export async function revokeApiKeyHandler(req: Request, res: Response) {
  const apiKey = await apiKeysService.revokeApiKey(req.auth!.orgId, requireParam(req, 'id'));
  res.status(200).json({ success: true, data: { apiKey } });
}
