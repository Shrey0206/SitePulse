import type { Request, Response } from 'express';
import { requireParam } from '../../shared/utils/params.js';
import {
  createIncidentSchema,
  listIncidentsQuerySchema,
  updateIncidentSchema,
} from './incidents.schemas.js';
import * as incidentsService from './incidents.service.js';

export async function createIncidentHandler(req: Request, res: Response) {
  const input = createIncidentSchema.parse(req.body);
  const incident = await incidentsService.createManualIncident(req.auth!.orgId, input);
  res.status(201).json({ success: true, data: { incident } });
}

export async function listIncidentsHandler(req: Request, res: Response) {
  const query = listIncidentsQuerySchema.parse(req.query);
  const incidents = await incidentsService.listIncidents(req.auth!.orgId, query);
  res.status(200).json({ success: true, data: { incidents } });
}

export async function getIncidentHandler(req: Request, res: Response) {
  const incident = await incidentsService.getIncident(req.auth!.orgId, requireParam(req, 'id'));
  res.status(200).json({ success: true, data: { incident } });
}

export async function updateIncidentHandler(req: Request, res: Response) {
  const input = updateIncidentSchema.parse(req.body);
  const incident = await incidentsService.updateManualIncident(req.auth!.orgId, requireParam(req, 'id'), input);
  res.status(200).json({ success: true, data: { incident } });
}

export async function resolveIncidentHandler(req: Request, res: Response) {
  const incident = await incidentsService.resolveIncident(req.auth!.orgId, requireParam(req, 'id'));
  res.status(200).json({ success: true, data: { incident } });
}

export async function deleteIncidentHandler(req: Request, res: Response) {
  await incidentsService.deleteManualIncident(req.auth!.orgId, requireParam(req, 'id'));
  res.status(204).send();
}
