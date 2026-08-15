import { z } from 'zod';

const name = z.string().trim().min(1).max(120);
const url = z
  .string()
  .trim()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'URL must use http or https');
const intervalSeconds = z.number().int().min(10).max(86400);
const timeoutSeconds = z.number().int().min(1).max(300);
const expectedStatus = z.number().int().min(100).max(599);
const failureThreshold = z.number().int().min(1).max(20);
const recoveryThreshold = z.number().int().min(1).max(20);

export const createMonitorSchema = z
  .object({
    name,
    url,
    intervalSeconds,
    timeoutSeconds,
    expectedStatus: expectedStatus.default(200),
    failureThreshold: failureThreshold.default(3),
    recoveryThreshold: recoveryThreshold.default(3),
  })
  .refine((data) => data.timeoutSeconds <= data.intervalSeconds, {
    message: 'timeoutSeconds must be <= intervalSeconds',
    path: ['timeoutSeconds'],
  });

export const updateMonitorSchema = z
  .object({
    name: name.optional(),
    url: url.optional(),
    intervalSeconds: intervalSeconds.optional(),
    timeoutSeconds: timeoutSeconds.optional(),
    expectedStatus: expectedStatus.optional(),
    failureThreshold: failureThreshold.optional(),
    recoveryThreshold: recoveryThreshold.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided')
  .refine(
    (data) =>
      data.timeoutSeconds === undefined ||
      data.intervalSeconds === undefined ||
      data.timeoutSeconds <= data.intervalSeconds,
    { message: 'timeoutSeconds must be <= intervalSeconds', path: ['timeoutSeconds'] },
  );

export type CreateMonitorInput = z.infer<typeof createMonitorSchema>;
export type UpdateMonitorInput = z.infer<typeof updateMonitorSchema>;
