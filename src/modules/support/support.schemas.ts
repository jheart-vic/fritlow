import { z } from 'zod';

// User starts a support thread — an optional subject plus the first message.
export const startConversationSchema = z.object({
  subject: z.string().trim().min(1).max(200).optional(),
  message: z.string().trim().min(1, 'Message cannot be empty').max(5000),
});

// Posting a reply (either side).
export const postMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message cannot be empty').max(5000),
});

// Staff updating a conversation's lifecycle.
export const updateConversationSchema = z.object({
  status: z.enum(['OPEN', 'CLOSED']),
});

// Admin inbox filters (parsed in the controller).
export const listConversationsQuerySchema = z.object({
  status: z.enum(['OPEN', 'CLOSED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type StartConversationInput = z.infer<typeof startConversationSchema>;
export type PostMessageInput = z.infer<typeof postMessageSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
