import { z } from 'zod';

export const decisionStatusValues = ['ACTIVE', 'REVISED', 'REVERSED'] as const;

export const createDecisionSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  reasoning: z.string().trim().min(1, 'Reasoning is required — that is the whole point of the log').max(5000),
});

export const updateDecisionSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    reasoning: z.string().trim().min(1).max(5000),
    status: z.enum(decisionStatusValues),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

export type CreateDecisionInput = z.infer<typeof createDecisionSchema>;
export type UpdateDecisionInput = z.infer<typeof updateDecisionSchema>;
