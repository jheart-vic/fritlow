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
  user: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
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

  const [workspace, inviter, sharedProjectCount] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true, isPersonal: true },
    }),
    prisma.user.findUnique({ where: { id: actorId }, select: { fullName: true } }),
    // What the invitee is about to gain access to. Membership is workspace-wide,
    // so this is the honest number to put in front of the founder before they
    // confirm — "add one collaborator" is never one project.
    prisma.project.count({ where: { workspaceId } }),
  ]);
  const workspaceName = workspace?.name ?? 'a workspace';

  // A personal workspace is where projects land by default, so it accumulates
  // everything a founder has ever started. Inviting someone there would hand
  // over that entire back catalogue as a side effect of adding one teammate —
  // so it is refused outright, not merely warned about.
  if (workspace?.isPersonal) {
    throw ApiError.badRequest(
      'You cannot invite people into your personal workspace — it stays private. ' +
        'Create a shared workspace, move the projects you want to collaborate on into it, ' +
        'and invite them there.',
    );
  }

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

    return { pending: true as const, invitation, sharedProjectCount };
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

  return { pending: false as const, member, sharedProjectCount };
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

const invitationInviterSelect = {
  invitedBy: { select: { id: true, fullName: true, avatarUrl: true } },
} as const;

// Outstanding invitations for a workspace (the "Invitation sent" rows). Manager
// only, since it lists invitee emails. Defaults to PENDING; pass all=true to
// include ACCEPTED/REVOKED history.
export async function listInvitations(actorId: string, workspaceId: string, all = false) {
  await assertManager(actorId, workspaceId);

  return prisma.workspaceInvitation.findMany({
    where: { workspaceId, ...(all ? {} : { status: 'PENDING' }) },
    orderBy: { createdAt: 'desc' },
    include: invitationInviterSelect,
  });
}

// Cancel a pending invitation (the "…" → Revoke action). Only PENDING invites
// can be revoked; already-accepted ones are memberships now (remove instead).
export async function revokeInvitation(actorId: string, workspaceId: string, invitationId: string) {
  await assertManager(actorId, workspaceId);

  const invitation = await prisma.workspaceInvitation.findUnique({ where: { id: invitationId } });
  if (!invitation || invitation.workspaceId !== workspaceId) {
    throw ApiError.notFound('Invitation not found in this workspace');
  }
  if (invitation.status !== 'PENDING') {
    throw ApiError.badRequest(`Only pending invitations can be revoked (this one is ${invitation.status})`);
  }

  return prisma.workspaceInvitation.update({
    where: { id: invitation.id },
    data: { status: 'REVOKED' },
    include: invitationInviterSelect,
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
