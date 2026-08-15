import type { Request, Response } from 'express';
import { requireParam } from '../../shared/utils/params.js';
import { createMonitorSchema, updateMonitorSchema } from './monitors.schemas.js';
import * as monitorsService from './monitors.service.js';

export async function createMonitorHandler(req: Request, res: Response) {
  const input = createMonitorSchema.parse(req.body);
  const monitor = await monitorsService.createMonitor(req.auth!.orgId, input);
  res.status(201).json({ success: true, data: { monitor } });
}

export async function listMonitorsHandler(req: Request, res: Response) {
  const monitors = await monitorsService.listMonitors(req.auth!.orgId);
  res.status(200).json({ success: true, data: { monitors } });
}

export async function getMonitorHandler(req: Request, res: Response) {
  const monitor = await monitorsService.getMonitor(req.auth!.orgId, requireParam(req, 'id'));
  res.status(200).json({ success: true, data: { monitor } });
}

export async function updateMonitorHandler(req: Request, res: Response) {
  const input = updateMonitorSchema.parse(req.body);
  const monitor = await monitorsService.updateMonitor(req.auth!.orgId, requireParam(req, 'id'), input);
  res.status(200).json({ success: true, data: { monitor } });
}

export async function deleteMonitorHandler(req: Request, res: Response) {
  await monitorsService.deleteMonitor(req.auth!.orgId, requireParam(req, 'id'));
  res.status(204).send();
}
