import { z } from 'zod';

// Input contracts for the Settings endpoints. validateBody runs these before
// the controller, so controllers/services can trust their input completely.

// Profile edits the user can make about themselves. Email is intentionally
// out of V1 scope — changing it would require re-running the verification flow.
export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(100),
});

// Changing the password while logged in — proves ownership with the current
// password (an access token alone shouldn't be enough to set a new one).
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const renameWorkspaceSchema = z.object({
  name: z.string().trim().min(2, 'Workspace name must be at least 2 characters').max(100),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type RenameWorkspaceInput = z.infer<typeof renameWorkspaceSchema>;
