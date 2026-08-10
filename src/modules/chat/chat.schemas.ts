import { z } from 'zod';

// A chat turn. Omit conversationId to start a new conversation.
export const sendMessageSchema = z.object({
  message: z.string().trim().min(1, 'Message cannot be empty').max(5000),
  conversationId: z.string().uuid('conversationId must be a valid id').optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
