import type { Request, Response } from 'express';
import { searchQuerySchema } from './search.schemas';
import * as searchService from './search.service';

// Behind requireAuth, so req.user is always present.

export async function search(req: Request, res: Response) {
  // Query strings aren't covered by validateBody, so parse them here (same
  // pattern as the projects list endpoint).
  const parsed = searchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  const result = await searchService.search(req.user!.id, parsed.data);
  res.status(200).json(result);
}
