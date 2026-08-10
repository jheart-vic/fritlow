import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/api-error';
import {
  sendWorkspaceInviteEmail,
  sendWorkspaceSignupInviteEmail,
} from '../../lib/email/email.service';
import { notify } from '../notifications/notification.service';
import type {
  CreateWorkspaceInput,
  InviteMemberInput,
  UpdateMemberRoleInput,
} from './workspace.schemas';

// Tenancy/RBAC rules for workspaces live here:
//  - any member can view the workspace and its members
//  - only OWNER/ADMIN can invite, change roles, or remove members
//  - only an OWNER can grant/remove/demote the OWNER role (ADMINs can't touch owners)
//  - a workspace must always keep at least one OWNER

const memberUserSelect = {
  user: { select: { id: true, fullName: true, email: true } },
} as const;

async function getMembership(userId: string, workspaceId: string) {
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!member) {
    throw ApiError.forbidden('You are not a member of this workspace');
  }
  return member;
}

// Gate for mutating membership: must be OWNER or ADMIN of the workspace.
async function assertManager(userId: string, workspaceId: string) {
  const member = await getMembership(userId, workspaceId);
  if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
    throw ApiError.forbidden('Only workspace owners or admins can manage members');
  }
  return member;
}

async function ownerCount(workspaceId: string): Promise<number> {
  return prisma.workspaceMember.count({ where: { workspaceId, role: 'OWNER' } });
}

export async function createWorkspace(userId: string, input: CreateWorkspaceInput) {
  // Workspace + its first membership (the creator as OWNER) + a default
  // "general" group-chat channel, all in one transaction.
  const workspace = await prisma.$transaction(async (tx) => {
    const created = await tx.workspace.create({ data: { name: input.name } });
    await tx.workspaceMember.create({
      data: { workspaceId: created.id, userId, role: 'OWNER' },
    });
    await tx.groupChannel.create({
      data: {
        workspaceId: created.id,
        name: 'general',
        description: 'Team-wide chat',
        createdById: userId,
      },
    });
    return created;
  });
  return { ...workspace, role: 'OWNER' as const };
}

export async function listMyWorkspaces(userId: string) {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    include: { workspace: true },
    orderBy: { createdAt: 'asc' },
  });
  // Flatten to the workspace plus the caller's role in it.
  return memberships.map((m) => ({ ...m.workspace, role: m.role }));
}

export async function listMembers(userId: string, workspaceId: string) {
  await getMembership(userId, workspaceId); // any member may view
  return prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: { userId: true, role: true, createdAt: true, ...memberUserSelect },
    orderBy: { createdAt: 'asc' },
  });
}

export async function inviteMember(
  actorId: string,
  workspaceId: string,
  input: InviteMemberInput,
) {
  const actor = await assertManager(actorId, workspaceId);

  const [workspace, inviter] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: actorId }, select: { fullName: true } }),
  ]);
  const workspaceName = workspace?.name ?? 'a workspace';

  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // No account yet → record a PENDING invitation and email a signup link.
  // The invite becomes a real membership when that email registers (see
  // consumePendingInvitations in auth.service).
  if (!user) {
    const invitation = await prisma.workspaceInvitation.upsert({
      where: { workspaceId_email: { workspaceId, email: input.email } },
      // A resend re-arms the invite (role may have changed; clear any prior state).
      update: { role: input.role, invitedById: actorId, status: 'PENDING', acceptedAt: null },
      create: { workspaceId, email: input.email, role: input.role, invitedById: actorId },
    });

    void sendWorkspaceSignupInviteEmail(
      { email: input.email },
      { workspaceName, inviterName: inviter?.fullName, role: input.role },
    );

    return { pending: true as const, invitation };
  }

  const existing = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
  });
  if (existing) {
    throw ApiError.conflict('That user is already a member of this workspace');
  }

  const member = await prisma.workspaceMember.create({
    data: { workspaceId, userId: user.id, role: input.role },
    select: { userId: true, role: true, createdAt: true, ...memberUserSelect },
  });

  // Best-effort heads-up to the invited (existing) user. Fire-and-forget:
  // sendSafely never throws, and we don't await so the invite response isn't
  // held up by the email provider.
  void sendWorkspaceInviteEmail(
    { email: user.email, name: user.fullName },
    { workspaceName, inviterName: inviter?.fullName, role: input.role },
  );

  // In-app heads-up for the invited (existing) user.
  notify({
    userId: user.id,
    type: 'WORKSPACE_INVITE',
    title: `You were added to ${workspaceName}`,
    body: inviter?.fullName ? `${inviter.fullName} added you as ${input.role.toLowerCase()}` : undefined,
    data: { workspaceId },
  });

  return { pending: false as const, member };
}

export async function updateMemberRole(
  actorId: string,
  workspaceId: string,
  targetUserId: string,
  input: UpdateMemberRoleInput,
) {
  const actor = await assertManager(actorId, workspaceId);

  const target = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
  });
  if (!target) {
    throw ApiError.notFound('That user is not a member of this workspace');
  }

  // Only owners may grant the OWNER role or change an existing owner's role.
  if ((input.role === 'OWNER' || target.role === 'OWNER') && actor.role !== 'OWNER') {
    throw ApiError.forbidden('Only an owner can manage the owner role');
  }

  // Never leave the workspace without an owner.
  if (target.role === 'OWNER' && input.role !== 'OWNER' && (await ownerCount(workspaceId)) === 1) {
    throw ApiError.badRequest('A workspace must have at least one owner');
  }

  return prisma.workspaceMember.update({
    where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
    data: { role: input.role },
    select: { userId: true, role: true, createdAt: true, ...memberUserSelect },
  });
}

export async function removeMember(actorId: string, workspaceId: string, targetUserId: string) {
  const actor = await assertManager(actorId, workspaceId);

  const target = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
  });
  if (!target) {
    throw ApiError.notFound('That user is not a member of this workspace');
  }

  // Removing an owner is an owner-only action, and never the last one.
  if (target.role === 'OWNER') {
    if (actor.role !== 'OWNER') {
      throw ApiError.forbidden('Only an owner can remove an owner');
    }
    if ((await ownerCount(workspaceId)) === 1) {
      throw ApiError.badRequest('A workspace must have at least one owner');
    }
  }

  await prisma.workspaceMember.delete({
    where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
  });
}

// Turn any PENDING invitations addressed to this email into real memberships.
// Called right after a new user is created at registration, so someone invited
// before they had an account lands in the workspace(s) automatically. Skips
// workspaces they somehow already belong to. Best-effort: a failure here must
// never fail registration, so callers invoke it fire-and-forget.
export async function consumePendingInvitations(userId: string, email: string): Promise<void> {
  const pending = await prisma.workspaceInvitation.findMany({
    where: { email, status: 'PENDING' },
  });
  if (pending.length === 0) return;

  for (const inv of pending) {
    await prisma.$transaction(async (tx) => {
      const already = await tx.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId: inv.workspaceId } },
      });
      if (!already) {
        await tx.workspaceMember.create({
          data: { workspaceId: inv.workspaceId, userId, role: inv.role },
        });
      }
      await tx.workspaceInvitation.update({
        where: { id: inv.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
    });
  }
}
