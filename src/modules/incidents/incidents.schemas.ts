import { z } from 'zod';

export const createIncidentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  monitorId: z.string().uuid().optional(),
});

export const updateIncidentSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

export const listIncidentsQuerySchema = z.object({
  status: z.enum(['open', 'resolved']).optional(),
  monitorId: z.string().uuid().optional(),
});

export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;
export type UpdateIncidentInput = z.infer<typeof updateIncidentSchema>;
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;
