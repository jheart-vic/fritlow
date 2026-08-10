import { z } from 'zod';

// Query params for GET /api/v1/admin/users (parsed in the controller).
export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // Optional search over email + full name.
  q: z.string().trim().min(1).max(200).optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
