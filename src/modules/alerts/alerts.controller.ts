import type { Request, Response } from 'express';
import { requireParam } from '../../shared/utils/params.js';
import * as channelsService from './alerts.channels.service.js';
import { encryptSecret, generateWebhookSecret } from './alerts.crypto.js';
import {
  createChannelSchema,
  listDeliveriesQuerySchema,
  updateChannelSchema,
} from './alerts.schemas.js';

export async function createChannelHandler(req: Request, res: Response) {
  const input = createChannelSchema.parse(req.body);

  if (input.type !== 'webhook') {
    const channel = await channelsService.createChannel(req.auth!.orgId, input);
    res.status(201).json({ success: true, data: { channel } });
    return;
  }

  const secret = generateWebhookSecret();
  const channel = await channelsService.createChannel(req.auth!.orgId, input, encryptSecret(secret));

  // Returned exactly once, at creation. The receiver needs the plaintext to verify
  // signatures, and no read endpoint ever exposes it again.
  res.status(201).json({
    success: true,
    data: {
      channel,
      secret,
      secretNotice: 'Store this signing secret now -- it will not be shown again.',
    },
  });
}

export async function listChannelsHandler(req: Request, res: Response) {
  const channels = await channelsService.listChannels(req.auth!.orgId);
  res.status(200).json({ success: true, data: { channels } });
}

export async function updateChannelHandler(req: Request, res: Response) {
  const input = updateChannelSchema.parse(req.body);
  const channel = await channelsService.updateChannel(req.auth!.orgId, requireParam(req, 'id'), input);
  res.status(200).json({ success: true, data: { channel } });
}

export async function deleteChannelHandler(req: Request, res: Response) {
  await channelsService.deleteChannel(req.auth!.orgId, requireParam(req, 'id'));
  res.status(204).send();
}

export async function listDeliveriesHandler(req: Request, res: Response) {
  const query = listDeliveriesQuerySchema.parse(req.query);
  const deliveries = await channelsService.listDeliveries(req.auth!.orgId, query);
  res.status(200).json({ success: true, data: { deliveries } });
}
