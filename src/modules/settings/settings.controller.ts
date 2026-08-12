import type { Request, Response } from 'express';
import { ApiError } from '../../utils/api-error';
import * as settingsService from './settings.service';

// All routes here sit behind requireAuth, so req.user is always present.
// Thin HTTP layer: read validated input, call the service, pick the status.

export async function updateProfile(req: Request, res: Response) {
  const user = await settingsService.updateProfile(req.user!.id, req.body);
  res.status(200).json({ user });
}

export async function updateAvatar(req: Request, res: Response) {
  // avatarUpload (multer) puts the parsed file on req.file.
  if (!req.file) {
    throw ApiError.badRequest('No image file provided (send multipart field "avatar")');
  }
  const user = await settingsService.updateAvatar(req.user!.id, req.file.buffer);
  res.status(200).json({ user });
}

export async function removeAvatar(req: Request, res: Response) {
  const user = await settingsService.removeAvatar(req.user!.id);
  res.status(200).json({ user });
}

export async function changePassword(req: Request, res: Response) {
  await settingsService.changePassword(req.user!.id, req.body);
  res.status(200).json({ message: 'Password updated. Please log in again.' });
}

export async function deleteAccount(req: Request, res: Response) {
  await settingsService.deleteAccount(req.user!.id, req.body);
  res.status(204).send();
}

export async function renameWorkspace(req: Request, res: Response) {
  const workspace = await settingsService.renameWorkspace(
    req.user!.id,
    req.params.workspaceId as string,
    req.body,
  );
  res.status(200).json({ workspace });
}
