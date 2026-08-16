import type { Request, Response } from 'express';
import { requireParam } from '../../shared/utils/params.js';
import * as statusPagesService from './statuspages.service.js';

export async function getStatusPageHandler(req: Request, res: Response) {
  const statusPage = await statusPagesService.getStatusPageBySlug(requireParam(req, 'slug'));

  // Short cache window: this is public and uncached at the DB, and status pages get
  // hammered exactly when something is broken. 15s keeps it usefully fresh while blunting
  // a refresh storm during an outage.
  res.set('Cache-Control', 'public, max-age=15');
  res.status(200).json({ success: true, data: statusPage });
}
