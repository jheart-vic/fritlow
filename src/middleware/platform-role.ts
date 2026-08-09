import type { NextFunction, Request, Response } from 'express';
import type { PlatformRole } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { ApiError } from '../utils/api-error';

// Gate for Fritlow-staff routes (/api/v1/admin/*). Must run AFTER requireAuth
// (it needs req.user). We read platformRole from the DB rather than trusting the
// JWT, so revoking someone's staff access takes effect immediately instead of
// waiting for their ~15-minute access token to expire.
export function requirePlatformRole(...allowed: PlatformRole[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { platformRole: true },
    });
    if (!user || !allowed.includes(user.platformRole)) {
      throw ApiError.forbidden('Staff access required');
    }
    next();
  };
}
