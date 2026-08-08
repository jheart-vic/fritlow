import { z } from 'zod';

// Input contracts for the recommendations endpoints.

// The founder acts on a recommendation by moving it out of PENDING.
// (PENDING is the generated default — you don't set it via the API.)
export const recommendationStatusValues = ['ACCEPTED', 'REJECTED'] as const;

export const updateRecommendationSchema = z.object({
  status: z.enum(recommendationStatusValues),
});

// Optional ?status= filter when listing. Includes PENDING here (unlike the
// update schema) because you can filter by any lifecycle state.
export const listRecommendationsQuerySchema = z.object({
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']).optional(),
});

export type UpdateRecommendationInput = z.infer<typeof updateRecommendationSchema>;
export type ListRecommendationsQuery = z.infer<typeof listRecommendationsQuerySchema>;
