import type { Request, Response } from 'express';
import * as templateService from './templates.service';

// Synchronous (data is in-memory). Express forwards a thrown ApiError from
// getTemplate to the error handler just like the async controllers.

export function list(_req: Request, res: Response) {
  res.status(200).json({ templates: templateService.listTemplates() });
}

export function getOne(req: Request, res: Response) {
  const template = templateService.getTemplate(req.params.id as string);
  res.status(200).json({ template });
}
