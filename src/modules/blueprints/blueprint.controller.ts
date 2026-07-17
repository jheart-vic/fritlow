import type { Request, Response } from 'express';
import * as blueprintService from './blueprint.service';

function projectId(req: Request): string {
  return req.params.projectId as string;
}

export async function generate(req: Request, res: Response) {
  const blueprint = await blueprintService.generateBlueprint(req.user!.id, projectId(req));
  res.status(201).json({ blueprint });
}

export async function get(req: Request, res: Response) {
  const blueprint = await blueprintService.getBlueprint(req.user!.id, projectId(req));
  res.status(200).json({ blueprint });
}

export async function updateSection(req: Request, res: Response) {
  const section = await blueprintService.updateSection(
    req.user!.id,
    projectId(req),
    req.params.sectionKey as string,
    req.body,
  );
  res.status(200).json({ section });
}
