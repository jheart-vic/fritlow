import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/api-error';
import {
  sendWorkspaceInviteEmail,
  sendWorkspaceSignupInviteEmail,
} from '../../lib/email/email.service';
import { notify } from '../notifications/notification.service';
import { generateOpaqueToken, hashToken } from '../../utils/tokens';
import type {
  CreateWorkspaceInput,
  DeleteWorkspaceInput,
  InviteMemberInput,
  UpdateMemberRoleInput,
} from './workspace.schemas';

// How long an invitation link stays good. Long enough to survive a holiday,
// short enough that a forgotten invite doesn't grant access a year later.
const INVITATION_TTL_DAYS = 14;

function invitationExpiry(): Date {
  return new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// A PENDING row past its expiry is EXPIRED in every way that matters. Deciding
// this on read rather than sweeping with a cron keeps the two from disagreeing:
// there is no window where the job hasn't run yet but the invite is stale.
// expiresAt is null on invitations created before expiry existed — those never
// expire, deliberately (see the migration note).
function isExpired(invitation: { status: string; expiresAt: Date | null }): boolean {
  return (
    invitation.status === 'PENDING' &&
    invitation.expiresAt !== null &&
    invitation.expiresAt < new Date()
  );
}

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
  const isPrivate = input.visibility === 'PRIVATE';

  // Workspace + its first membership (the creator as OWNER), and for shared
  // workspaces a default "general" chat channel — all in one transaction.
  const workspace = await prisma.$transaction(async (tx) => {
    const created = await tx.workspace.create({ data: { name: input.name, isPrivate } });
    await tx.workspaceMember.create({
      data: { workspaceId: created.id, userId, role: 'OWNER' },
    });

    // No team channel in a private workspace — there is no team to chat with,
    // and one appears automatically if it is ever converted to shared.
    if (!isPrivate) {
      await tx.groupChannel.create({
        data: {
          workspaceId: created.id,
          name: 'general',
          description: 'Team-wide chat',
          createdById: userId,
        },
      });
    }

    if (input.setAsDefault) {
      await tx.user.update({
        where: { id: userId },
        data: { defaultWorkspaceId: created.id },
      });
    }

    return created;
  });

  return { ...workspace, role: 'OWNER' as const, isDefault: input.setAsDefault };
}

// Point "where new projects land" at a different workspace.
//
// Restricted to workspaces the caller OWNS. Membership alone isn't enough: a
// MEMBER of a shared workspace defaulting into it would quietly publish every
// project they start to that whole team, and an ADMIN could not undo it for
// them. Owning it means the consequence is theirs to choose.
export async function setDefaultWorkspace(userId: string, workspaceId: string) {
  const member = await getMembership(userId, workspaceId);
  if (member.role !== 'OWNER') {
    throw ApiError.forbidden('You can only default into a workspace you own');
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, isPrivate: true, createdAt: true, updatedAt: true },
  });
  if (!workspace) {
    throw ApiError.notFound('Workspace not found');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { defaultWorkspaceId: workspaceId },
  });

  // Surfaced so the frontend can warn on the shared case — projects created
  // without naming a workspace will now be visible to everyone in it.
  return {
    ...workspace,
    role: member.role,
    isDefault: true,
    warning: workspace.isPrivate
      ? null
      : 'New projects will be created in a shared workspace, visible to all its members.',
  };
}

// Turn a private workspace into a shared one — the deliberate way to say
// "yes, I want to collaborate on everything already in here".
//
// The projects come along, which is the whole point: you are choosing to share
// them. Flipping isPrivate alone is never enough, though. If this workspace was
// also the user's default, every project they create from now on would land in
// a space their invitees can read. So the transaction also mints a fresh
// private workspace and repoints the default at it.
export async function convertPersonalToShared(userId: string, workspaceId: string) {
  const member = await getMembership(userId, workspaceId);
  // Owner-only: this changes what a future invite can expose, so it is not a
  // call an ADMIN should be able to make on someone else's private space.
  if (member.role !== 'OWNER') {
    throw ApiError.forbidden('Only the workspace owner can convert it to a shared workspace');
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, isPrivate: true },
  });
  if (!workspace) {
    throw ApiError.notFound('Workspace not found');
  }
  if (!workspace.isPrivate) {
    throw ApiError.badRequest('This workspace is already shared — you can invite people to it');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true, defaultWorkspaceId: true },
  });

  const [converted, personal] = await prisma.$transaction(
    async (tx) => {
      const updated = await tx.workspace.update({
        where: { id: workspaceId },
        data: { isPrivate: false },
      });

      // Shared workspaces get a team channel; private ones never had one.
      // upsert rather than findFirst-then-create: the @@unique([workspaceId,
      // name]) index makes this atomic, so two concurrent converts can't both
      // decide the channel is missing and each insert one.
      await tx.groupChannel.upsert({
        where: { workspaceId_name: { workspaceId, name: 'general' } },
        update: {},
        create: {
          workspaceId,
          name: 'general',
          description: 'Team-wide chat',
          createdById: userId,
        },
      });

      // The replacement private space.
      const fresh = await tx.workspace.create({
        data: {
          name: `${(user?.fullName ?? 'My').split(' ')[0]}'s Workspace`,
          isPrivate: true,
          members: { create: { userId, role: 'OWNER' } },
        },
      });

      // Repoint the default only if it was aimed at the workspace we just
      // shared. Someone converting a private workspace that ISN'T their
      // default has already chosen where projects go — moving it would
      // override a deliberate decision.
      if (user?.defaultWorkspaceId === workspaceId) {
        await tx.user.update({
          where: { id: userId },
          data: { defaultWorkspaceId: fresh.id },
        });
      }

      return [updated, fresh] as const;
    },
    { maxWait: 10000, timeout: 15000 },
  );

  return {
    workspace: { ...converted, role: 'OWNER' as const },
    personalWorkspace: { ...personal, role: 'OWNER' as const },
  };
}

// Close a shared workspace back up. The return trip for convertPersonalToShared.
//
// Allowed ONLY when the caller is the sole member. "Private" means nobody can
// be invited, so a private workspace with four people in it is a contradiction.
// The alternative — silently ejecting everyone — would revoke several people's
// access to every project in here with no warning to them, which is exactly
// what the move notifications exist to prevent. Removing them first is a
// deliberate act with its own audit trail.
//
// Projects stay put, and the team chat channel is left in place rather than
// deleted: its history is real, and converting back later finds the existing
// channel (the workspaceId+name unique index guarantees no duplicate).
export async function convertSharedToPrivate(userId: string, workspaceId: string) {
  const member = await getMembership(userId, workspaceId);
  if (member.role !== 'OWNER') {
    throw ApiError.forbidden('Only the workspace owner can make it private');
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, isPrivate: true },
  });
  if (!workspace) {
    throw ApiError.notFound('Workspace not found');
  }
  if (workspace.isPrivate) {
    throw ApiError.badRequest('This workspace is already private');
  }

  const others = await prisma.workspaceMember.findMany({
    where: { workspaceId, userId: { not: userId } },
    select: { user: { select: { fullName: true } } },
  });
  if (others.length > 0) {
    const names = others.map((m) => m.user.fullName).join(', ');
    throw ApiError.badRequest(
      `Remove the other ${others.length} member${others.length === 1 ? '' : 's'} first (${names}). ` +
        'A private workspace is one nobody else can be in.',
    );
  }

  // Any invitations still in flight would let someone into a workspace that is
  // now private — a contradiction the moment they accept. Revoke them.
  const [updated] = await prisma.$transaction([
    prisma.workspace.update({
      where: { id: workspaceId },
      data: { isPrivate: true },
    }),
    prisma.workspaceInvitation.updateMany({
      where: { workspaceId, status: 'PENDING' },
      data: { status: 'REVOKED' },
    }),
  ]);

  return { ...updated, role: 'OWNER' as const };
}

export async function listMyWorkspaces(userId: string) {
  const [memberships, user] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { defaultWorkspaceId: true } }),
  ]);

  // Flatten to the workspace, the caller's role in it, and whether it is where
  // their new projects land. isDefault is per-caller — the same workspace is
  // the default for one member and not for another — so it belongs here
  // rather than on the Workspace row.
  return memberships.map((m) => ({
    ...m.workspace,
    role: m.role,
    isDefault: m.workspaceId === user?.defaultWorkspaceId,
  }));
}

// What deleting this workspace would destroy, for the confirmation dialog.
//
// OWNER-only like the delete itself, so this cannot be used to count another
// workspace's members. Returns everything the dialog needs to be specific
// rather than asking "are you sure?" over a blank.
export async function previewDeleteWorkspace(userId: string, workspaceId: string) {
  const member = await getMembership(userId, workspaceId);
  if (member.role !== 'OWNER') {
    throw ApiError.forbidden('Only the workspace owner can delete it');
  }

  const [workspace, user, projectCount, otherMembers, ownedCount] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, isPrivate: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { defaultWorkspaceId: true } }),
    prisma.project.count({ where: { workspaceId } }),
    prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { not: userId } },
      select: { role: true, user: { select: { id: true, fullName: true, avatarUrl: true } } },
    }),
    prisma.workspaceMember.count({ where: { userId, role: 'OWNER' } }),
  ]);
  if (!workspace) {
    throw ApiError.notFound('Workspace not found');
  }

  const isDefault = user?.defaultWorkspaceId === workspaceId;

  return {
    workspace,
    // The number that should appear in the confirmation copy. Every one of
    // these takes its blueprint, discovery interview, comments and exports
    // with it — this is not a "remove from list" operation.
    projectCount,
    otherMembers: { count: otherMembers.length, users: otherMembers.map((m) => m.user) },
    isDefault,
    // The UI should make the user pick a replacement default up front rather
    // than discovering the requirement in a 400.
    requiresNewDefault: isDefault && ownedCount > 1,
    // Refused outright — see deleteWorkspace.
    isLastOwnedWorkspace: ownedCount === 1,
  };
}

// Delete a workspace and everything in it. Irreversible.
//
// Cascades take out the projects and, through them, blueprints, discovery
// sessions, decisions, comments, exports and documents. There is no soft
// delete and no undo, which is why this asks the user to retype the name.
export async function deleteWorkspace(
  userId: string,
  workspaceId: string,
  input: DeleteWorkspaceInput,
) {
  const member = await getMembership(userId, workspaceId);
  if (member.role !== 'OWNER') {
    throw ApiError.forbidden('Only the workspace owner can delete it');
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true },
  });
  if (!workspace) {
    throw ApiError.notFound('Workspace not found');
  }

  // Trimmed, but case-sensitive: this is a deliberate friction step, and a
  // near-miss should fail rather than be helpfully accepted.
  if (input.confirmName.trim() !== workspace.name) {
    throw ApiError.badRequest(
      `Type the workspace name exactly to confirm deletion (expected "${workspace.name}")`,
    );
  }

  // Everyone needs somewhere to put a project. Deleting your only workspace
  // would leave you with no valid default and nowhere for the next one to go.
  const ownedCount = await prisma.workspaceMember.count({ where: { userId, role: 'OWNER' } });
  if (ownedCount === 1) {
    throw ApiError.badRequest(
      'This is the only workspace you own — create another one before deleting it.',
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { defaultWorkspaceId: true },
  });

  // If this was where their projects landed, they must name the replacement.
  // The FK is SetNull, so skipping this would leave them with no default and
  // a confusing 400 on their next project create.
  if (user?.defaultWorkspaceId === workspaceId) {
    if (!input.newDefaultWorkspaceId) {
      throw ApiError.badRequest(
        'This is your default workspace — pass newDefaultWorkspaceId to say where new projects should land instead.',
      );
    }
    if (input.newDefaultWorkspaceId === workspaceId) {
      throw ApiError.badRequest('The new default cannot be the workspace you are deleting');
    }
    const replacement = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: input.newDefaultWorkspaceId } },
    });
    if (!replacement || replacement.role !== 'OWNER') {
      throw ApiError.badRequest('You can only default into a workspace you own');
    }
  }

  // Read the roster BEFORE the delete — afterwards the membership rows are
  // gone and there is no way to know who to tell.
  const others = await prisma.workspaceMember.findMany({
    where: { workspaceId, userId: { not: userId } },
    select: { userId: true },
  });
  const projectCount = await prisma.project.count({ where: { workspaceId } });
  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true },
  });

  await prisma.$transaction(
    async (tx) => {
      if (input.newDefaultWorkspaceId && user?.defaultWorkspaceId === workspaceId) {
        await tx.user.update({
          where: { id: userId },
          data: { defaultWorkspaceId: input.newDefaultWorkspaceId },
        });
      }
      // Other members pointing their default here are handled by the FK's
      // SetNull — they are asked to choose on their next project create.
      await tx.workspace.delete({ where: { id: workspaceId } });
    },
    { maxWait: 10000, timeout: 15000 },
  );

  // Their work is gone and there is nothing left to link to, so this
  // notification is the entire record they get. Sent after the transaction
  // commits — telling people their workspace vanished when the delete then
  // rolled back would be worse than telling them late.
  for (const other of others) {
    notify({
      userId: other.userId,
      type: 'WORKSPACE_DELETED',
      title: `${workspace.name} was deleted`,
      body: `${actor?.fullName ?? 'The owner'} deleted this workspace and its ${projectCount} project${projectCount === 1 ? '' : 's'}.`,
      // No workspaceId — the row no longer exists, so a click-through would 404.
      data: { workspaceName: workspace.name },
    });
  }
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
      select: { name: true, isPrivate: true },
    }),
    prisma.user.findUnique({ where: { id: actorId }, select: { fullName: true } }),
    // What the invitee is about to gain access to. Membership is workspace-wide,
    // so this is the honest number to put in front of the founder before they
    // confirm — "add one collaborator" is never one project.
    prisma.project.count({ where: { workspaceId } }),
  ]);
  const workspaceName = workspace?.name ?? 'a workspace';

  // Membership is workspace-wide, so inviting someone into a private workspace
  // would hand over every project in it as a side effect of adding one
  // teammate. Refused outright rather than warned about — the user's route to
  // sharing is to move the specific projects into a shared workspace, or to
  // convert this one deliberately.
  if (workspace?.isPrivate) {
    throw ApiError.badRequest(
      'You cannot invite people into a private workspace. ' +
        'Move the projects you want to collaborate on into a shared workspace and invite them ' +
        'there, or convert this workspace to shared if you mean to share everything in it.',
    );
  }

  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Already in? Nothing to invite them to.
  if (user) {
    const existing = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId } },
    });
    if (existing) {
      throw ApiError.conflict('That user is already a member of this workspace');
    }
  }

  // EVERY invite is a PENDING row now, account or not. Membership is created
  // only when the invitee accepts — being added to a workspace without consent
  // would drop someone else's projects into your sidebar on their say-so.
  const token = generateOpaqueToken();
  const invitation = await prisma.workspaceInvitation.upsert({
    where: { workspaceId_email: { workspaceId, email: input.email } },
    // A resend re-arms the invite: the role may have changed, and any prior
    // DECLINED/REVOKED/EXPIRED state has to clear or the row stays dead.
    // A fresh token also invalidates the link in the earlier email.
    update: {
      role: input.role,
      invitedById: actorId,
      status: 'PENDING',
      acceptedAt: null,
      tokenHash: hashToken(token),
      expiresAt: invitationExpiry(),
    },
    create: {
      workspaceId,
      email: input.email,
      role: input.role,
      invitedById: actorId,
      tokenHash: hashToken(token),
      expiresAt: invitationExpiry(),
    },
  });

  // Fire-and-forget on both paths: sendSafely never throws, and the response
  // must not wait on the email provider.
  if (user) {
    void sendWorkspaceInviteEmail(
      { email: user.email, name: user.fullName },
      { workspaceName, inviterName: inviter?.fullName, role: input.role, token },
    );
    notify({
      userId: user.id,
      type: 'WORKSPACE_INVITE',
      title: `${inviter?.fullName ?? 'Someone'} invited you to ${workspaceName}`,
      body: `Join as ${input.role.toLowerCase()} to see its ${sharedProjectCount} project${sharedProjectCount === 1 ? '' : 's'}`,
      data: { workspaceId, invitationId: invitation.id },
    });
  } else {
    void sendWorkspaceSignupInviteEmail(
      { email: input.email },
      { workspaceName, inviterName: inviter?.fullName, role: input.role, token },
    );
  }

  // `pending` is always true now. Kept in the response so the frontend's
  // existing discriminator keeps parsing; `hasAccount` is what actually varies
  // and tells the UI whether to say "invitation sent" or "signup link sent".
  return { pending: true as const, hasAccount: Boolean(user), invitation, sharedProjectCount };
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

  await prisma.$transaction(async (tx) => {
    await tx.workspaceMember.delete({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
    });

    // If this workspace was where their new projects landed, that pointer now
    // aims somewhere they cannot reach and their next project create would
    // fail with a confusing error. Clear it so they are asked to choose.
    // updateMany (not update) because it no-ops when the pointer is elsewhere.
    await tx.user.updateMany({
      where: { id: targetUserId, defaultWorkspaceId: workspaceId },
      data: { defaultWorkspaceId: null },
    });
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

const invitationWorkspaceSelect = {
  workspace: { select: { id: true, name: true, isPrivate: true } },
  invitedBy: { select: { id: true, fullName: true, avatarUrl: true } },
} as const;

// The invitations addressed to ME that are still actionable — the "you've been
// invited" list. Matched on email, not membership, so it works the same whether
// the invite predates the account or not. Expired rows are filtered out rather
// than shown greyed: an invitation you cannot act on is noise.
export async function listMyInvitations(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user) throw ApiError.notFound('User not found');

  const invitations = await prisma.workspaceInvitation.findMany({
    where: { email: user.email, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    include: invitationWorkspaceSelect,
  });

  const live = invitations.filter((inv) => !isExpired(inv));

  // How much each invitation is actually offering. Membership is workspace-wide,
  // so "join this workspace" always means "see all N of its projects" — the
  // invitee deserves that number before they accept, not after.
  const counts = await prisma.project.groupBy({
    by: ['workspaceId'],
    where: { workspaceId: { in: live.map((i) => i.workspaceId) } },
    _count: { _all: true },
  });
  const countByWorkspace = new Map(counts.map((c) => [c.workspaceId, c._count._all]));

  return live.map((inv) => ({
    ...inv,
    projectCount: countByWorkspace.get(inv.workspaceId) ?? 0,
  }));
}

// Read an invitation from its token WITHOUT being logged in.
//
// This exists so the invite-link landing page can render before auth. Every
// other invitation route sits behind requireAuth, which means a logged-out
// click could only ever produce a bare login form with no workspace name, no
// inviter and no project count — the flow reads as broken rather than merely
// unpolished.
//
// Authorization is the token itself: high-entropy, stored only as a SHA-256
// hash, and looked up by exact match. There is no listing and nothing to
// enumerate — you either hold the link that was emailed to you or you get a
// 404. Rate-limited at the route as cheap insurance against grinding.
//
// Everything returned here was already in the invitation email the caller is
// holding, so this discloses nothing new to a legitimate recipient.
export async function lookupInvitation(token: string) {
  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: invitationWorkspaceSelect,
  });
  if (!invitation) {
    throw ApiError.notFound('Invitation not found');
  }

  // Expiry is derived on read everywhere else; report it the same way here
  // rather than leaving the page to compare timestamps itself.
  const status = isExpired(invitation) ? 'EXPIRED' : invitation.status;

  // Whether the invited address already has an account — this is what lets the
  // page send the visitor to sign-in vs sign-up instead of guessing. It is an
  // account-existence signal, but gated behind holding a valid invitation
  // token for that exact address, which the inviter already knew.
  const account = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true },
  });

  const projectCount = await prisma.project.count({
    where: { workspaceId: invitation.workspaceId },
  });

  return {
    // Deliberately no workspaceId and no project names — the visitor is not a
    // member yet and may never accept. The name and count are what the email
    // already told them.
    workspace: { name: invitation.workspace.name, isPrivate: invitation.workspace.isPrivate },
    invitedBy: invitation.invitedBy,
    // Returned so the page can compare it against the current session and say
    // "this invitation is for ada@… , you are signed in as bob@…".
    email: invitation.email,
    role: invitation.role,
    status,
    expiresAt: invitation.expiresAt,
    projectCount,
    accountExists: Boolean(account),
    // Only PENDING invitations can be acted on; everything else needs its own
    // message rather than a generic failure.
    actionable: status === 'PENDING',
  };
}

// Load an invitation the CALLER is entitled to act on, by id or by raw token.
// The email must match: an invitation id is a uuid, but guessing one must not
// let a third party join a workspace they were never invited to.
async function getActionableInvitation(
  userId: string,
  opts: { invitationId?: string; token?: string },
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user) throw ApiError.notFound('User not found');

  const invitation = opts.token
    ? await prisma.workspaceInvitation.findUnique({
        where: { tokenHash: hashToken(opts.token) },
        include: invitationWorkspaceSelect,
      })
    : await prisma.workspaceInvitation.findUnique({
        where: { id: opts.invitationId },
        include: invitationWorkspaceSelect,
      });

  if (!invitation || invitation.email !== user.email) {
    throw ApiError.notFound('Invitation not found');
  }
  if (isExpired(invitation)) {
    throw ApiError.badRequest('This invitation has expired — ask them to send a new one');
  }
  if (invitation.status !== 'PENDING') {
    throw ApiError.badRequest(
      invitation.status === 'ACCEPTED'
        ? 'You have already accepted this invitation'
        : `This invitation is no longer open (${invitation.status.toLowerCase()})`,
    );
  }
  return invitation;
}

// Accept an invitation: this is the moment membership is actually created.
export async function acceptInvitation(
  userId: string,
  opts: { invitationId?: string; token?: string },
) {
  const invitation = await getActionableInvitation(userId, opts);

  const membership = await prisma.$transaction(async (tx) => {
    // Re-read status inside the transaction so a double-click can't create two
    // memberships — the second pass sees ACCEPTED and stops. updateMany with a
    // status filter is the atomic guard: it reports 0 rows changed if another
    // request got there first.
    const claimed = await tx.workspaceInvitation.updateMany({
      where: { id: invitation.id, status: 'PENDING' },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw ApiError.conflict('This invitation has already been used');
    }

    const already = await tx.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: invitation.workspaceId } },
    });
    if (already) return already;

    return tx.workspaceMember.create({
      data: { workspaceId: invitation.workspaceId, userId, role: invitation.role },
    });
  });

  return { workspace: invitation.workspace, role: membership.role };
}

// Turn an invitation down. DECLINED rather than deleted so the inviter sees
// what happened instead of the row silently vanishing from their list.
export async function declineInvitation(userId: string, invitationId: string) {
  const invitation = await getActionableInvitation(userId, { invitationId });

  return prisma.workspaceInvitation.update({
    where: { id: invitation.id },
    data: { status: 'DECLINED' },
    include: invitationWorkspaceSelect,
  });
}

// Called right after registration. Accepts ONLY the invitation whose token was
// carried through the signup link — clicking that link is the consent.
//
// Invitations to the same email that the user did NOT arrive through stay
// PENDING and show up in their in-app list. Auto-joining those would mean
// anyone who knows your email address can decide, before you have ever heard
// of Fritlow, which workspaces appear in your sidebar on day one.
//
// Best-effort: a failure here must never fail registration, so callers invoke
// it fire-and-forget.
export async function consumeInvitationToken(
  userId: string,
  email: string,
  token: string,
): Promise<void> {
  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!invitation || invitation.status !== 'PENDING' || isExpired(invitation)) return;

  // The invitation was addressed to a specific person. Holding the token is
  // not enough — the account being created has to be the one it was sent to.
  //
  // Without this, forwarding the invite email hands over the workspace: the
  // recipient registers with their OWN address, the token still matches, and
  // they land in every project inside. The inviter picked an email; a forward
  // must not silently transfer that access to someone else.
  if (invitation.email !== email.toLowerCase()) return;

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.workspaceInvitation.updateMany({
      where: { id: invitation.id, status: 'PENDING' },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    if (claimed.count === 0) return;

    const already = await tx.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: invitation.workspaceId } },
    });
    if (!already) {
      await tx.workspaceMember.create({
        data: { workspaceId: invitation.workspaceId, userId, role: invitation.role },
      });
    }
  });
}

// Remove yourself from a workspace. The necessary counterpart to requiring
// acceptance: if you can be invited, you must be able to get out without
// having to ask an owner to remove you.
export async function leaveWorkspace(userId: string, workspaceId: string): Promise<void> {
  const member = await getMembership(userId, workspaceId);

  // Same invariant as removeMember — a workspace is never left ownerless.
  if (member.role === 'OWNER' && (await ownerCount(workspaceId)) === 1) {
    throw ApiError.badRequest(
      'You are the only owner of this workspace — promote another owner before leaving, ' +
        'or delete the workspace instead.',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.workspaceMember.delete({
      where: { userId_workspaceId: { userId, workspaceId } },
    });

    // Leaving the workspace your projects default into would leave that pointer
    // aimed somewhere you can no longer reach, and the next project create
    // would fail. Clear it; createProject then asks them to choose.
    await tx.user.updateMany({
      where: { id: userId, defaultWorkspaceId: workspaceId },
      data: { defaultWorkspaceId: null },
    });
  });
}
