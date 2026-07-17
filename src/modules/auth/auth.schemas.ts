import { z } from 'zod';

// Input contracts for every auth endpoint. The validateBody middleware runs
// these before the controller, so controllers/services never see bad input.

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(100),
  email: z.email('Invalid email address').toLowerCase(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
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

// z.infer turns a schema into a TypeScript type — one definition, used both
// for runtime validation and compile-time typing.
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
