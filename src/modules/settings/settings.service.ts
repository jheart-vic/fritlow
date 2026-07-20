import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/api-error';
import { hashPassword, verifyPassword } from '../../utils/password';
import { type PublicUser, toPublicUser } from '../auth/auth.service';
import type {
  ChangePasswordInput,
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
