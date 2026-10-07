import { z } from 'zod';
import { CHAT_SERVICE_LABEL, type ChatChannelType, isChatWebhookUrl } from './alerts.chat.js';

/** The pasted URL; the controller swaps `target` for a masked label before storing it. */
function chatWebhookUrl(type: ChatChannelType) {
  return z
    .string()
    .trim()
    .refine(
      (value) => isChatWebhookUrl(type, value),
      `Must be a ${CHAT_SERVICE_LABEL[type]} incoming-webhook URL`,
    );
}

export const createChannelSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('email'),
    target: z.string().trim().toLowerCase().email(),
    enabled: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('webhook'),
    target: z
      .string()
      .trim()
      .url()
      .refine((value) => /^https?:\/\//i.test(value), 'Webhook URL must use http or https'),
    enabled: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('discord'),
    target: chatWebhookUrl('discord'),
    enabled: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('slack'),
    target: chatWebhookUrl('slack'),
    enabled: z.boolean().default(true),
  }),
]);

export const updateChannelSchema = z
  .object({ enabled: z.boolean().optional() })
  .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

export const listDeliveriesQuerySchema = z.object({
  incidentId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuerySchema>;
