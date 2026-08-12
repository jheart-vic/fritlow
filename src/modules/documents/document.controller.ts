import type { Request, Response } from 'express';
import { ApiError } from '../../utils/api-error';
import * as documentService from './document.service';

// Mounted at /api/v1/projects/:projectId/documents with mergeParams, so
// req.params.projectId comes from the parent path.

function projectId(req: Request): string {
  return req.params.projectId as string;
}

export async function upload(req: Request, res: Response) {
  // documentUpload (multer) puts the parsed file on req.file.
  if (!req.file) {
    throw ApiError.badRequest('No file provided (send multipart field "document")');
  }
  const document = await documentService.uploadDocument(req.user!.id, projectId(req), req.file);
  // 202: the row exists, but extraction is still running — poll GET for status.
  res.status(202).json({ document });
}

export async function list(req: Request, res: Response) {
  const documents = await documentService.listDocuments(req.user!.id, projectId(req));
  res.status(200).json({ documents });
}

export async function get(req: Request, res: Response) {
  const document = await documentService.getDocument(
    req.user!.id,
    projectId(req),
    req.params.documentId as string,
  );
  res.status(200).json({ document });
}

export async function remove(req: Request, res: Response) {
  await documentService.deleteDocument(
    req.user!.id,
    projectId(req),
    req.params.documentId as string,
  );
  res.status(204).send();
}
