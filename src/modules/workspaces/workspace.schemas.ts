import { z } from 'zod';

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, 'Workspace name must be at least 2 characters').max(100),
});

// Invite an EXISTING Fritlow user into a workspace. Inviting people without an
// account (email token + acceptance flow) is deferred to Team Collaboration
// (v1.1); for now the invitee must already have signed up. OWNER isn't grantable
// on invite — promote via the role endpoint instead.
export const inviteMemberSchema = z.object({
  email: z.email('Invalid email address').toLowerCase(),
  role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
