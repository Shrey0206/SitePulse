import type { Request, Response } from 'express';
import { AppError } from '../../shared/errors/AppError.js';
import { requireParam } from '../../shared/utils/params.js';
import * as channelsService from './alerts.channels.service.js';
import {
  createChannelSchema,
  listDeliveriesQuerySchema,
  updateChannelSchema,
} from './alerts.schemas.js';

export async function createChannelHandler(req: Request, res: Response) {
  const input = createChannelSchema.parse(req.body);

  if (input.type === 'webhook') {
    // Webhook channels need an encrypted signing secret, which lands with Day 13. Failing
    // loudly is the right call -- silently storing a webhook with no secret would produce
    // unsigned callouts that receivers can't verify.
    throw new AppError(501, 'NOT_IMPLEMENTED', 'Webhook channels are not available yet');
  }

  const channel = await channelsService.createChannel(req.auth!.orgId, input);
  res.status(201).json({ success: true, data: { channel } });
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
