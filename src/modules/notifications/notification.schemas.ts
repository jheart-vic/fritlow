import { z } from 'zod';

// Query params for GET /api/v1/notifications (parsed in the controller).
export const listNotificationsQuerySchema = z.object({
  // ?unread=true → only unread. Anything else → all.
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
