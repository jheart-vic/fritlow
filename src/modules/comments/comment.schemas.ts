import { z } from 'zod';

// Create a comment on a blueprint section. `parentId` (optional) makes it a
// reply in a thread; omit it for a top-level comment.
export const createCommentSchema = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty').max(5000),
  parentId: z.string().uuid('parentId must be a valid comment id').optional(),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
