import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env';
import { ApiError } from '../../utils/api-error';
import * as authService from './auth.service';

// Controllers are deliberately thin: read the (already validated) request,
// call the service, choose the status code. All business logic lives in
// auth.service.ts so it can be tested and reused without HTTP.

const REFRESH_COOKIE = 'fritlow_rt';

// httpOnly: JavaScript (including injected XSS scripts) can never read it.
// path: the browser only sends it to /api/v1/auth/* — no other endpoint sees it.
// secure + sameSite=none in production (HTTPS, cross-site); lax for local dev.
const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SECURE ? 'none' : 'lax',
  path: '/api/v1/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
};

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions);
}

// Browsers send the cookie; non-browser clients (mobile, scripts, Swagger
// try-it-out from another origin) may send the token in the body instead.
function readRefreshToken(req: Request): string {
  const token: unknown = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
  if (typeof token !== 'string' || token.length === 0) {
    throw ApiError.unauthorized('Missing refresh token (cookie or body)');
  }
  return token;
}

export async function register(req: Request, res: Response) {
  const { refreshToken, ...result } = await authService.register(req.body);
  setRefreshCookie(res, refreshToken);
  res.status(201).json(result);
}

export async function login(req: Request, res: Response) {
  const { refreshToken, ...result } = await authService.login(req.body);
  setRefreshCookie(res, refreshToken);
  res.status(200).json(result);
}

export async function refresh(req: Request, res: Response) {
  const { refreshToken, accessToken } = await authService.refresh(readRefreshToken(req));
  setRefreshCookie(res, refreshToken);
  res.status(200).json({ accessToken });
}

export async function logout(req: Request, res: Response) {
  await authService.logout(readRefreshToken(req));
  res.clearCookie(REFRESH_COOKIE, { path: refreshCookieOptions.path });
  res.status(204).send();
}

export async function me(req: Request, res: Response) {
  // requireAuth middleware guarantees req.user exists on this route.
  const user = await authService.getMe(req.user!.id);
  res.status(200).json({ user });
}

export async function verifyEmail(req: Request, res: Response) {
  const user = await authService.verifyEmail(req.body);
  res.status(200).json({ message: 'Email verified.', user });
}

export async function resendVerification(req: Request, res: Response) {
  const result = await authService.resendVerification(req.body);
  res.status(200).json({
    message: 'If an unverified account exists for that email, a verification link has been sent.',
    ...result,
  });
}

export async function forgotPassword(req: Request, res: Response) {
  const result = await authService.forgotPassword(req.body);
  res.status(200).json({
    message: 'If an account exists for that email, a reset link has been sent.',
    ...result,
  });
}

export async function resetPassword(req: Request, res: Response) {
  await authService.resetPassword(req.body);
  res.status(200).json({ message: 'Password updated. Please log in again.' });
}
