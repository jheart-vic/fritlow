import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from '../../lib/email/email.service';
import { ApiError } from '../../utils/api-error';
import { hashPassword, verifyPassword } from '../../utils/password';
import {
  generateOpaqueToken,
  hashToken,
  signAccessToken,
} from '../../utils/tokens';
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResendVerificationInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from './auth.schemas';

const RESET_TOKEN_TTL_MINUTES = 30;
const VERIFY_TOKEN_TTL_HOURS = 24;

// Shape returned to clients — never includes passwordHash.
export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  emailVerified: boolean;
  createdAt: Date;
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  // Dev-only convenience until email delivery exists.
  verificationToken?: string;
}

function toPublicUser(user: {
  id: string;
  email: string;
  fullName: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt,
  };
}

// Creates a fresh verification token for the user (stored hashed, like all
// token tables). Returns the raw token — that's what goes in the email link.
async function issueVerificationToken(userId: string): Promise<string> {
  const token = generateOpaqueToken();
  await prisma.emailVerificationToken.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_HOURS * 60 * 60 * 1000),
    },
  });
  return token;
}

// Creates the short-lived JWT and a long-lived refresh token (stored hashed).
async function issueTokens(user: { id: string; email: string }) {
  const accessToken = signAccessToken({ sub: user.id, email: user.email });

  const refreshToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: { tokenHash: hashToken(refreshToken), userId: user.id, expiresAt },
  });

  return { accessToken, refreshToken };
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const passwordHash = await hashPassword(input.password);

  // $transaction: either the user AND their personal workspace are created,
  // or neither is — no half-registered accounts.
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email: input.email, fullName: input.fullName, passwordHash },
    });

    await tx.workspace.create({
      data: {
        name: `${input.fullName.split(' ')[0]}'s Workspace`,
        members: { create: { userId: created.id, role: 'OWNER' } },
      },
    });

    return created;
  });

  const verificationToken = await issueVerificationToken(user.id);
  // Fire-and-forget: sendSafely never throws, and registration must not
  // wait on (or fail because of) the email provider.
  void sendVerificationEmail({ email: user.email, name: user.fullName }, verificationToken);
  if (env.NODE_ENV === 'development') {
    console.log(`[dev] Email verification token for ${user.email}: ${verificationToken}`);
  }

  const tokens = await issueTokens(user);
  return {
    user: toPublicUser(user),
    ...tokens,
    ...(env.NODE_ENV === 'development' ? { verificationToken } : {}),
  };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Same error whether the email or the password is wrong — otherwise an
  // attacker could probe which emails have accounts.
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const tokens = await issueTokens(user);
  return { user: toPublicUser(user), ...tokens };
}

export async function refresh(refreshTokenRaw: string): Promise<{ accessToken: string; refreshToken: string }> {
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshTokenRaw) },
    include: { user: true },
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  // Rotation: the old token is revoked and a fresh one issued. A stolen
  // token therefore works at most once.
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  return issueTokens(stored.user);
}

export async function logout(refreshTokenRaw: string): Promise<void> {
  // Revoke if it exists; logging out with an unknown token is not an error.
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshTokenRaw), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getMe(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw ApiError.notFound('User no longer exists');
  }
  return toPublicUser(user);
}

export async function verifyEmail(input: VerifyEmailInput): Promise<PublicUser> {
  const stored = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
  });

  if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
    throw ApiError.badRequest('Invalid or expired verification token');
  }

  // Mark the user verified and burn the token together — a token can never
  // be spent without the user actually flipping to verified, and vice versa.
  const [user] = await prisma.$transaction([
    prisma.user.update({
      where: { id: stored.userId },
      data: { emailVerifiedAt: new Date() },
    }),
    prisma.emailVerificationToken.update({
      where: { id: stored.id },
      data: { usedAt: new Date() },
    }),
  ]);

  return toPublicUser(user);
}

export async function resendVerification(
  input: ResendVerificationInput,
): Promise<{ verificationToken?: string }> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Same shape whether the account exists, is already verified, or is
  // unknown — the response never reveals which emails are registered.
  if (!user || user.emailVerifiedAt) return {};

  // Invalidate older unused tokens so only the newest link works.
  await prisma.emailVerificationToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const verificationToken = await issueVerificationToken(user.id);
  void sendVerificationEmail({ email: user.email, name: user.fullName }, verificationToken);

  if (env.NODE_ENV === 'development') {
    console.log(`[dev] Email verification token for ${user.email}: ${verificationToken}`);
    return { verificationToken };
  }

  return {};
}

export async function forgotPassword(input: ForgotPasswordInput): Promise<{ resetToken?: string }> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Always respond success to the client (don't reveal which emails exist),
  // but only create a token when the account is real.
  if (!user) return {};

  const resetToken = generateOpaqueToken();
  await prisma.passwordResetToken.create({
    data: {
      tokenHash: hashToken(resetToken),
      userId: user.id,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
    },
  });

  void sendPasswordResetEmail({ email: user.email, name: user.fullName }, resetToken);

  if (env.NODE_ENV === 'development') {
    console.log(`[dev] Password reset token for ${user.email}: ${resetToken}`);
    return { resetToken };
  }

  return {};
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const stored = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
  });

  if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
    throw ApiError.badRequest('Invalid or expired reset token');
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
    // Changing the password logs out every existing session.
    prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}
