import type { Request, Response } from 'express';
import * as decisionService from './decision.service';

function projectId(req: Request): string {
  return req.params.projectId as string;
}

export async function create(req: Request, res: Response) {
  const decision = await decisionService.createDecision(req.user!.id, projectId(req), req.body);
  res.status(201).json({ decision });
}

export async function list(req: Request, res: Response) {
  const decisions = await decisionService.listDecisions(req.user!.id, projectId(req));
  res.status(200).json({ decisions });
}

export async function update(req: Request, res: Response) {
  const decision = await decisionService.updateDecision(
    req.user!.id,
    projectId(req),
    req.params.id as string,
    req.body,
  );
  res.status(200).json({ decision });
}

export async function remove(req: Request, res: Response) {
  await decisionService.deleteDecision(req.user!.id, projectId(req), req.params.id as string);
  res.status(204).send();
}
