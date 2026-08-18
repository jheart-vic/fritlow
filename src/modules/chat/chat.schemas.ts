import { z } from 'zod';

// A chat turn. Omit conversationId to start a new conversation.
export const sendMessageSchema = z.object({
  message: z.string().trim().min(1, 'Message cannot be empty').max(5000),
  conversationId: z.string().uuid('conversationId must be a valid id').optional(),
});

// Rename a conversation. Title is nullable: clearing it drops the chat back to
// whatever the UI shows for an untitled conversation, which is a real thing a
// user may want after a bad rename.
export const renameConversationSchema = z.object({
  title: z.string().trim().min(1, 'Title cannot be empty').max(120).nullable(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type RenameConversationInput = z.infer<typeof renameConversationSchema>;
