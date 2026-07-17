import type { Request, Response } from 'express';
import * as healthService from './health.service';

function projectId(req: Request): string {
  return req.params.projectId as string;
}

export async function compute(req: Request, res: Response) {
  const healthScore = await healthService.computeHealthScore(req.user!.id, projectId(req));
  res.status(200).json({ healthScore });
}

export async function get(req: Request, res: Response) {
  const healthScore = await healthService.getHealthScore(req.user!.id, projectId(req));
  res.status(200).json({ healthScore });
}
