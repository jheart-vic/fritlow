import { z } from 'zod';

export const createChannelSchema = z.object({
  name: z.string().trim().min(1, 'Channel name is required').max(80),
  description: z.string().trim().max(500).optional(),
});

export const updateChannelSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update' });

export const postGroupMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message cannot be empty').max(5000),
  // Optional list of workspace-member user ids to @mention (they get notified).
  mentions: z.array(z.string().uuid()).max(50).optional(),
});

export const listMessagesQuerySchema = z.object({
  // ISO timestamp cursor — return messages older than this (for scroll-back).
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
export type PostGroupMessageInput = z.infer<typeof postGroupMessageSchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
