import { z } from 'zod';

// Input contracts for the recommendations endpoints. Shapes follow the
// frontend build spec.

// The founder moves a recommendation out of OPEN via PATCH (acknowledge /
// dismiss / resolve). OPEN is the generated default — not set via the API.
export const recommendationStatusValues = ['ACKNOWLEDGED', 'DISMISSED', 'RESOLVED'] as const;

export const updateRecommendationSchema = z.object({
  status: z.enum(recommendationStatusValues),
});

// Optional ?status= filter when listing — accepts any lifecycle state
// (including OPEN, unlike the update schema).
export const listRecommendationsQuerySchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'DISMISSED', 'RESOLVED']).optional(),
});

export type UpdateRecommendationInput = z.infer<typeof updateRecommendationSchema>;
export type ListRecommendationsQuery = z.infer<typeof listRecommendationsQuerySchema>;
