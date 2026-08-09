import { z } from 'zod';

// Query params for GET /api/v1/search. Parsed in the controller (validateBody
// only covers request bodies, and search takes no body).
export const searchQuerySchema = z.object({
  // The search term. At least 2 chars so we don't run a "%%" scan of everything.
  q: z.string().trim().min(2, 'Search query must be at least 2 characters').max(200),
  // Max hits PER result type. Coerced because query strings arrive as strings.
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
