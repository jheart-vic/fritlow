import { z } from 'zod';

// PRIVATE  — nobody can be invited; the invite endpoint refuses it outright.
// SHARED   — invite-only collaboration space, and gets a `general` chat channel.
//
// Deliberately an enum, not an `isPrivate` boolean: it reads unambiguously in
// the contract and leaves room for a third state later without a breaking
// change. "SHARED" rather than "PUBLIC" because these workspaces are never
// discoverable — you only get in by invitation, and "public" would suggest
// otherwise to anyone reading the create dialog.
//
// Defaults to SHARED: a workspace you deliberately create is almost always one
// you intend to collaborate in. The private workspace everyone starts with is
// created for them at registration.
export const workspaceVisibilitySchema = z.enum(['PRIVATE', 'SHARED']).default('SHARED');

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, 'Workspace name must be at least 2 characters').max(100),
  visibility: workspaceVisibilitySchema,
  // Make this the workspace where new projects land. Optional, and only
  // sensible on a PRIVATE workspace for most users — but allowed either way,
  // since "everything I start goes to my agency workspace" is a legitimate
  // choice as long as it is an explicit one.
  setAsDefault: z.boolean().default(false),
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

// Deleting a workspace destroys every project in it, irreversibly.
//
// `confirmName` must match the workspace's name exactly — the type-the-name
// pattern. A plain boolean `confirm: true` would not help: the failure mode
// here is not "clicked without thinking", it is "deleted the wrong workspace
// from a list of six". Retyping the name is the only confirmation that proves
// WHICH workspace the user means, not merely that they meant to delete one.
export const deleteWorkspaceSchema = z.object({
  confirmName: z.string().min(1, 'Type the workspace name to confirm'),
  // Required when the workspace being deleted is where your new projects land.
  // We refuse to pick a replacement automatically — the whole point of the
  // explicit pointer is that nobody's projects get silently rehomed.
  newDefaultWorkspaceId: z.uuid().optional(),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type DeleteWorkspaceInput = z.infer<typeof deleteWorkspaceSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
