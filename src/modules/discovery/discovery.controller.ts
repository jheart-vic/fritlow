import type { Request, Response } from 'express';
import * as discoveryService from './discovery.service';

// These routes are mounted at /api/v1/projects/:projectId/discovery with
// mergeParams, so req.params.projectId comes from the parent path.

function projectId(req: Request): string {
  return req.params.projectId as string;
}

export async function start(req: Request, res: Response) {
  const result = await discoveryService.startSession(req.user!.id, projectId(req));
  res.status(201).json(result);
}

export async function get(req: Request, res: Response) {
  const result = await discoveryService.getSession(req.user!.id, projectId(req));
  res.status(200).json(result);
}

export async function answer(req: Request, res: Response) {
  const result = await discoveryService.submitAnswer(req.user!.id, projectId(req), req.body);
  res.status(200).json(result);
}

export async function complete(req: Request, res: Response) {
  const session = await discoveryService.completeSession(req.user!.id, projectId(req));
  res.status(200).json({ session });
}
