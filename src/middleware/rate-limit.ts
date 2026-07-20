import type { Request, Response } from 'express';
import { type ClientRateLimitInfo, rateLimit } from 'express-rate-limit';
import { env } from '../config/env';

// Rate limiting for the unauthenticated auth endpoints. Two concerns:
//   1. Brute force / junk accounts on login + register.
//   2. Quota + inbox abuse on the email-sending endpoints (resend-verification,
//      forgot-password) — those are open to the world and each call spends real
//      Brevo credits (300/day on the free tier), so they get a much tighter cap.
//
// We use express-rate-limit's default in-memory store: fine for a single
// instance (the MVP). When we scale to multiple instances behind a load
// balancer each process would keep its own counters, so switch the store to
// Redis (rate-limit-redis, backed by the same Upstash we add at deploy) then.

const MINUTE_MS = 60 * 1000;

// Builds a limiter that answers with our standard `{ error }` JSON shape and a
// Retry-After header (seconds until the window resets), matching the 429
// contract documented in the OpenAPI spec.
function buildLimiter(options: { windowMin: number; max: number; message: string }) {
  return rateLimit({
    windowMs: options.windowMin * MINUTE_MS,
    limit: options.max,
    // Emit the standard `RateLimit-*` headers; drop the legacy `X-RateLimit-*`.
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Skip counting entirely in tests (and when the operator disables it) so the
    // suite and local tinkering aren't throttled.
    skip: () => !env.RATE_LIMIT_ENABLED || env.NODE_ENV === 'test',
    handler: (req: Request, res: Response) => {
      // express-rate-limit attaches the client's window info here (default key
      // `rateLimit`); it isn't in the base Express Request type, so read it off
      // a narrowed view rather than augmenting the global type.
      const info = (req as { rateLimit?: ClientRateLimitInfo }).rateLimit;
      const resetTime = info?.resetTime;
      const retryAfterSec = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(options.windowMin * 60);
      res.setHeader('Retry-After', retryAfterSec);
      res.status(429).json({ error: options.message });
    },
  });
}

// Login, register, and the token-consuming endpoints (verify-email,
// reset-password, refresh) — enough headroom for real users, tight enough to
// blunt password/token guessing.
export const authLimiter = buildLimiter({
  windowMin: env.AUTH_RATE_LIMIT_WINDOW_MIN,
  max: env.AUTH_RATE_LIMIT_MAX,
  message: 'Too many attempts. Please wait a bit and try again.',
});

// Resend-verification + forgot-password — strictest, because every request
// triggers a real outbound email.
export const emailLimiter = buildLimiter({
  windowMin: env.EMAIL_RATE_LIMIT_WINDOW_MIN,
  max: env.EMAIL_RATE_LIMIT_MAX,
  message: 'Too many email requests. Please wait before requesting another.',
});
