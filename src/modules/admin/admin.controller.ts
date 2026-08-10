import type { Request, Response } from 'express';
import { listUsersQuerySchema } from './admin.schemas';
import * as adminService from './admin.service';

// Behind requireAuth + requirePlatformRole, so the caller is known staff.

export async function stats(_req: Request, res: Response) {
  res.status(200).json(await adminService.getStats());
}

export async function listUsers(req: Request, res: Response) {
  const parsed = listUsersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  res.status(200).json(await adminService.listUsers(parsed.data));
}

export async function getUser(req: Request, res: Response) {
  const user = await adminService.getUser(req.params.id as string);
  res.status(200).json({ user });
}
