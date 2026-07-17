import type { Request, Response } from 'express';
import { listProjectsQuerySchema } from './project.schemas';
import * as projectService from './project.service';

// All routes here sit behind requireAuth, so req.user is always present.

export async function create(req: Request, res: Response) {
  const project = await projectService.createProject(req.user!.id, req.body);
  res.status(201).json({ project });
}

export async function list(req: Request, res: Response) {
  // Query strings aren't covered by validateBody (it validates bodies),
  // so the status filter is parsed here.
  const query = listProjectsQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: query.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  const projects = await projectService.listProjects(req.user!.id, query.data);
  res.status(200).json({ projects });
}

export async function getOne(req: Request, res: Response) {
  const project = await projectService.getProject(req.user!.id, req.params.id as string);
  res.status(200).json({ project });
}

export async function update(req: Request, res: Response) {
  const project = await projectService.updateProject(req.user!.id, req.params.id as string, req.body);
  res.status(200).json({ project });
}

export async function remove(req: Request, res: Response) {
  await projectService.deleteProject(req.user!.id, req.params.id as string);
  res.status(204).send();
}
