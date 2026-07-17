import { z } from 'zod';

export const submitAnswerSchema = z.object({
  questionId: z.string().min(1, 'questionId is required'),
  // Free-form text today; JSONB storage means richer shapes can come later.
  answer: z.string().trim().min(1, 'Answer cannot be empty').max(5000),
  // Reply to the AI-generated follow-up on this question, if one exists.
  followUpAnswer: z.string().trim().min(1).max(5000).optional(),
});

export type SubmitAnswerInput = z.infer<typeof submitAnswerSchema>;
