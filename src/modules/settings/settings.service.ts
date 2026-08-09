import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/api-error';
import { hashPassword, verifyPassword } from '../../utils/password';
import { type PublicUser, toPublicUser } from '../auth/auth.service';
import type {
  ChangePasswordInput,
  DeleteAccountInput,
  RenameWorkspaceInput,
  UpdateProfileInput,
} from './settings.schemas';

// Settings = the logged-in user acting on their OWN account and workspaces.
// Every function is scoped by the authenticated userId the controller passes in.

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<PublicUser> {
  // The route is behind requireAuth, so the user is known to exist; update
  // returns the fresh row, which we serialize through the shared mapper.
  const user = await prisma.user.update({
    where: { id: userId },
    data: { fullName: input.fullName },
  });
  return toPublicUser(user);
}

export async function changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw ApiError.notFound('User no longer exists');
  }

  // Re-authenticate with the current password before allowing the change.
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw ApiError.unauthorized('Current password is incorrect');
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    // Same rule as reset-password: a password change revokes every existing
    // session, so a previously-stolen refresh token stops working.
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

// A shared placeholder account that inherits authorship of a deleted user's
// content in workspaces OTHER people still use — so teammates' comment threads,
// decision logs, and blueprint history don't lose their anchor. It can never be
// logged into (random password, and it's never exposed by any auth flow).
const DELETED_SENTINEL_EMAIL = 'deleted-user@fritlow.internal';

async function getDeletedSentinelId(): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { email: DELETED_SENTINEL_EMAIL } });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: {
      email: DELETED_SENTINEL_EMAIL,
      fullName: 'Deleted User',
      passwordHash: await hashPassword(randomUUID()),
      emailVerifiedAt: new Date(),
    },
  });
  return created.id;
}

export async function deleteAccount(userId: string, input: DeleteAccountInput): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw ApiError.notFound('User no longer exists');
  }

  // Re-authenticate — deleting an account is irreversible.
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw ApiError.unauthorized('Password is incorrect');
  }

  // Classify each of the user's workspaces:
  //  - only member → delete the whole workspace (cascades its projects/content)
  //  - shared but they're the SOLE owner → block; they must hand it off first,
  //    otherwise we'd orphan other people's workspace.
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    select: { workspaceId: true, role: true },
  });

  const soleMemberWorkspaceIds: string[] = [];
  for (const m of memberships) {
    const [memberCount, ownerCount] = await Promise.all([
      prisma.workspaceMember.count({ where: { workspaceId: m.workspaceId } }),
      prisma.workspaceMember.count({ where: { workspaceId: m.workspaceId, role: 'OWNER' } }),
    ]);
    if (memberCount === 1) {
      soleMemberWorkspaceIds.push(m.workspaceId);
    } else if (m.role === 'OWNER' && ownerCount === 1) {
      throw ApiError.badRequest(
        'You are the sole owner of a shared workspace. Transfer ownership or remove the other members before deleting your account.',
      );
    }
  }

  const sentinelId = await getDeletedSentinelId();

  // One transaction so the account is either fully gone or fully intact.
  // maxWait/timeout bumped for Neon's pooled connection cold-starts.
  await prisma.$transaction(
    async (tx) => {
      // 1. Workspaces where they were the only member — cascade removes the
      //    projects, blueprints, comments, decisions, etc. inside them.
      if (soleMemberWorkspaceIds.length > 0) {
        await tx.workspace.deleteMany({ where: { id: { in: soleMemberWorkspaceIds } } });
      }

      // 2. Anything the user authored that SURVIVES (now all in shared
      //    workspaces) is reassigned to the sentinel, both to preserve
      //    teammates' context and to clear the FK constraints that would
      //    otherwise block the user delete. Sequential — interactive
      //    transactions run on a single connection.
      await tx.project.updateMany({ where: { createdById: userId }, data: { createdById: sentinelId } });
      await tx.decisionLog.updateMany({ where: { createdById: userId }, data: { createdById: sentinelId } });
      await tx.comment.updateMany({ where: { authorId: userId }, data: { authorId: sentinelId } });
      await tx.blueprintSectionVersion.updateMany({ where: { editedById: userId }, data: { editedById: sentinelId } });
      await tx.export.updateMany({ where: { createdById: userId }, data: { createdById: sentinelId } });
      await tx.workspaceInvitation.updateMany({ where: { invitedById: userId }, data: { invitedById: sentinelId } });

      // 3. Delete the user — memberships and all token tables cascade.
      await tx.user.delete({ where: { id: userId } });
    },
    { maxWait: 15000, timeout: 15000 },
  );
}

export async function renameWorkspace(
  userId: string,
  workspaceId: string,
  input: RenameWorkspaceInput,
) {
  // Same tenancy gate the projects module uses: you must belong to the
  // workspace, and only OWNER/ADMIN may change workspace-level settings.
  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!member) {
    throw ApiError.forbidden('You are not a member of this workspace');
  }
  if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
    throw ApiError.forbidden('Only workspace owners or admins can rename the workspace');
  }

  return prisma.workspace.update({
    where: { id: workspaceId },
    data: { name: input.name },
  });
}
