import { z } from 'zod';

// Create a comment on a blueprint section. `parentId` (optional) makes it a
// reply in a thread; omit it for a top-level comment.
export const createCommentSchema = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty').max(5000),
  parentId: z.string().uuid('parentId must be a valid comment id').optional(),
});

// Edit an existing comment. Only the body is editable — a comment can't be
// moved to another section or re-parented into a different thread, which would
// change what the surrounding replies appear to be answering.
export const editCommentSchema = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty').max(5000),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type EditCommentInput = z.infer<typeof editCommentSchema>;
