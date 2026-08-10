import type { Request, Response } from 'express';
import * as commentService from './comment.service';

// All routes sit behind requireAuth, so req.user is always present.

export async function create(req: Request, res: Response) {
  const comment = await commentService.createComment(
    req.user!.id,
    req.params.projectId as string,
    req.params.sectionKey as string,
    req.body,
  );
  res.status(201).json({ comment });
}

export async function list(req: Request, res: Response) {
  const comments = await commentService.listComments(
    req.user!.id,
    req.params.projectId as string,
    req.params.sectionKey as string,
  );
  res.status(200).json({ comments });
}

export async function remove(req: Request, res: Response) {
  await commentService.deleteComment(req.user!.id, req.params.id as string);
  res.status(204).send();
}
