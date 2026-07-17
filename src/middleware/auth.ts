import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/api-error';
import { verifyAccessToken } from '../utils/tokens';

// Make req.user known to TypeScript on every request object.
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string };
    }
  }
}

// Protects a route: requires "Authorization: Bearer <access token>".
// On success, attaches { id, email } as req.user for downstream handlers.
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Missing Authorization header');
  }

  const payload = verifyAccessToken(header.slice('Bearer '.length));
  req.user = { id: payload.sub, email: payload.email };
  next();
}
