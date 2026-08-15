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

export async function setDefault(req: Request, res: Response) {
  const workspace = await workspaceService.setDefaultWorkspace(
    req.user!.id,
    req.params.workspaceId as string,
  );
  res.status(200).json({ workspace });
}

export async function convertToShared(req: Request, res: Response) {
  const result = await workspaceService.convertPersonalToShared(
    req.user!.id,
    req.params.workspaceId as string,
  );
  res.status(200).json(result);
}

export async function deletePreview(req: Request, res: Response) {
  const preview = await workspaceService.previewDeleteWorkspace(
    req.user!.id,
    req.params.workspaceId as string,
  );
  res.status(200).json(preview);
}

export async function remove(req: Request, res: Response) {
  await workspaceService.deleteWorkspace(
    req.user!.id,
    req.params.workspaceId as string,
    req.body,
  );
  res.status(204).send();
}

export async function convertToPrivate(req: Request, res: Response) {
  const workspace = await workspaceService.convertSharedToPrivate(
    req.user!.id,
    req.params.workspaceId as string,
  );
  res.status(200).json({ workspace });
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
  // Always a pending invitation now — nobody joins a workspace without
  // accepting. hasAccount tells the UI which email went out: an accept link
  // for existing users, a signup link for everyone else.
  res.status(201).json({
    pending: true,
    hasAccount: result.hasAccount,
    invitation: result.invitation,
    sharedProjectCount: result.sharedProjectCount,
  });
}

// Public — no req.user here, unlike every other handler in this file.
export async function lookupInvitation(req: Request, res: Response) {
  const invitation = await workspaceService.lookupInvitation(req.params.token as string);
  res.status(200).json({ invitation });
}

export async function listMyInvitations(req: Request, res: Response) {
  const invitations = await workspaceService.listMyInvitations(req.user!.id);
  res.status(200).json({ invitations });
}

export async function acceptInvitation(req: Request, res: Response) {
  // Accept by id (from the in-app list) or by token (from the emailed link).
  const result = await workspaceService.acceptInvitation(req.user!.id, {
    invitationId: req.params.invitationId as string | undefined,
    token: req.body?.token as string | undefined,
  });
  res.status(200).json(result);
}

export async function declineInvitation(req: Request, res: Response) {
  const invitation = await workspaceService.declineInvitation(
    req.user!.id,
    req.params.invitationId as string,
  );
  res.status(200).json({ invitation });
}

export async function leaveWorkspace(req: Request, res: Response) {
  await workspaceService.leaveWorkspace(req.user!.id, req.params.workspaceId as string);
  res.status(204).send();
}

export async function listInvitations(req: Request, res: Response) {
  const all = req.query.all === 'true';
  const invitations = await workspaceService.listInvitations(
    req.user!.id,
    req.params.workspaceId as string,
    all,
  );
  res.status(200).json({ invitations });
}

export async function revokeInvitation(req: Request, res: Response) {
  const invitation = await workspaceService.revokeInvitation(
    req.user!.id,
    req.params.workspaceId as string,
    req.params.invitationId as string,
  );
  res.status(200).json({ invitation });
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
