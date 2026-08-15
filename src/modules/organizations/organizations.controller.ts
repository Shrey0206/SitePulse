import type { Request, Response } from 'express';
import * as organizationsService from './organizations.service.js';

export async function getMyOrganizationHandler(req: Request, res: Response) {
  // requireAuth ran first and either populated req.auth or threw, so this is safe.
  const { orgId } = req.auth!;
  const organization = await organizationsService.getOrganizationById(orgId);
  res.status(200).json({ success: true, data: { organization } });
}
