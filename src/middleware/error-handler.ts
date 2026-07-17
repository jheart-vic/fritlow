import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/api-error';
import { env } from '../config/env';

// Express identifies the error handler by its 4-argument signature.
// Every thrown error in a route ends up here (Express 5 forwards rejected
// promises from async handlers automatically).
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  // Unexpected error: log the details server-side, hide them from the client.
  console.error('Unhandled error:', err);
  return res.status(500).json({
    error: 'Internal server error',
    ...(env.NODE_ENV === 'development' && err instanceof Error ? { detail: err.message } : {}),
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
}
