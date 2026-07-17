import { z } from 'zod';

export const updateSectionSchema = z.object({
  // Section content is markdown for V1 (the frontend's Tiptap editor
  // round-trips it); stored as JSONB { markdown } server-side.
  markdown: z.string().trim().min(1, 'Section content cannot be empty').max(50000),
});

export type UpdateSectionInput = z.infer<typeof updateSectionSchema>;
