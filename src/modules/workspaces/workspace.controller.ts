import type { Request, Response } from 'express';
import * as workspaceService from './workspace.service';

// All routes sit behind requireAuth, so req.user is always present.

export async function create(req: Request, res: Response) {
  const workspace = await workspaceService.createWorkspace(req.user!.id, req.body);
  res.status(201).json({ workspace });
}

export async function list(req: Request, res: Response) {
  const workspaces = await workspaceService.listMyWorkspaces(req.user!.id);
  res.status(200).json({ workspaces });
}

export async function listMembers(req: Request, res: Response) {
  const members = await workspaceService.listMembers(req.user!.id, req.params.workspaceId as string);
  res.status(200).json({ members });
}

export async function inviteMember(req: Request, res: Response) {
  const result = await workspaceService.inviteMember(
    req.user!.id,
    req.params.workspaceId as string,
    req.body,
  );
  // Existing user → added immediately. Unknown email → a pending invitation
  // was recorded and a signup email sent; they join when they register.
  if (result.pending) {
    res.status(201).json({ pending: true, invitation: result.invitation });
  } else {
    res.status(201).json({ member: result.member });
  }
}

export async function updateMemberRole(req: Request, res: Response) {
  const member = await workspaceService.updateMemberRole(
    req.user!.id,
    req.params.workspaceId as string,
    req.params.userId as string,
    req.body,
  );
  res.status(200).json({ member });
}

export async function removeMember(req: Request, res: Response) {
  await workspaceService.removeMember(
    req.user!.id,
    req.params.workspaceId as string,
    req.params.userId as string,
  );
  res.status(204).send();
}
