import { z } from 'zod';

export const submitAnswerSchema = z.object({
  questionId: z.string().min(1, 'questionId is required'),
  // Free-form text today; JSONB storage means richer shapes can come later.
  answer: z.string().trim().min(1, 'Answer cannot be empty').max(5000),
});

export type SubmitAnswerInput = z.infer<typeof submitAnswerSchema>;
