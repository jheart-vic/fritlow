import type { Request, Response } from 'express';
import { listRecommendationsQuerySchema } from './recommendation.schemas';
import * as recommendationService from './recommendation.service';

function projectId(req: Request): string {
  return req.params.projectId as string;
}

export async function generate(req: Request, res: Response) {
  const recommendations = await recommendationService.generateRecommendations(
    req.user!.id,
    projectId(req),
  );
  res.status(201).json({ recommendations });
}

export async function list(req: Request, res: Response) {
  // Query strings aren't covered by validateBody (it validates bodies),
  // so the optional status filter is parsed here.
  const query = listRecommendationsQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: query.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  const recommendations = await recommendationService.listRecommendations(
    req.user!.id,
    projectId(req),
    query.data,
  );
  res.status(200).json({ recommendations });
}

export async function update(req: Request, res: Response) {
  const recommendation = await recommendationService.updateRecommendationStatus(
    req.user!.id,
    projectId(req),
    req.params.id as string,
    req.body,
  );
  res.status(200).json({ recommendation });
}
