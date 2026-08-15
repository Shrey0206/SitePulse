import { pool } from '../../db/pool.js';
import { AppError } from '../../shared/errors/AppError.js';

interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: Date;
}

export async function getOrganizationById(organizationId: string): Promise<Organization> {
  const result = await pool.query<Organization>(
    `SELECT id, name, slug, created_at FROM organizations WHERE id = $1`,
    [organizationId],
  );
  const organization = result.rows[0];
  if (!organization) {
    throw new AppError(404, 'ORGANIZATION_NOT_FOUND', 'Organization not found');
  }
  return organization;
}
