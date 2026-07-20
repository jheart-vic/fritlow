import type { Request, Response } from 'express';
import * as settingsService from './settings.service';

// All routes here sit behind requireAuth, so req.user is always present.
// Thin HTTP layer: read validated input, call the service, pick the status.

export async function updateProfile(req: Request, res: Response) {
  const user = await settingsService.updateProfile(req.user!.id, req.body);
  res.status(200).json({ user });
}

export async function changePassword(req: Request, res: Response) {
  await settingsService.changePassword(req.user!.id, req.body);
  res.status(200).json({ message: 'Password updated. Please log in again.' });
}

export async function renameWorkspace(req: Request, res: Response) {
  const workspace = await settingsService.renameWorkspace(
    req.user!.id,
    req.params.workspaceId as string,
    req.body,
  );
  res.status(200).json({ workspace });
}
