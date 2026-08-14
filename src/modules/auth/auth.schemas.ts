import { z } from 'zod';

// Input contracts for every auth endpoint. The validateBody middleware runs
// these before the controller, so controllers/services never see bad input.

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(100),
  email: z.email('Invalid email address').toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  // Set when the user arrived via a workspace invite link (?invitation=...).
  // Registering through that link IS the acceptance, so they join immediately.
  // Any OTHER invitations to their email stay pending for them to accept in
  // app — signing up is not consent to join workspaces you never clicked.
  // Invalid or expired tokens are ignored rather than failing registration:
  // a bad link should not cost someone their account.
  invitationToken: z.string().trim().min(1).optional(),
});

export const loginSchema = z.object({
  email: z.email('Invalid email address').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

// refreshToken in the body is a fallback for non-browser clients (mobile,
// scripts). Browsers send it via the httpOnly cookie instead.
export const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.email('Invalid email address').toLowerCase(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Verification token is required'),
});

export const resendVerificationSchema = z.object({
  email: z.email('Invalid email address').toLowerCase(),
});

// z.infer turns a schema into a TypeScript type — one definition, used both
// for runtime validation and compile-time typing.
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
