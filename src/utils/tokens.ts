import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from './api-error';

// ── Access tokens (JWT) ────────────────────────────────────────────────
// Short-lived (15m), stateless: the server verifies the signature instead
// of hitting the database on every request.

export interface AccessTokenPayload {
  sub: string; // user id ("subject" — standard JWT claim)
  email: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  } catch {
    throw ApiError.unauthorized('Invalid or expired access token');
  }
}

// ── Refresh + reset tokens (opaque random strings) ─────────────────────
// Long-lived, stateful: stored in the database (hashed) so they can be
// revoked. The client gets the raw token; we keep only the SHA-256 hash.

export function generateOpaqueToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
