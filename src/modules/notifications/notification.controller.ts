import type { Request, Response } from 'express';
import { listNotificationsQuerySchema } from './notification.schemas';
import * as notificationService from './notification.service';

// All routes behind requireAuth; everything is scoped to req.user.

export async function list(req: Request, res: Response) {
  const parsed = listNotificationsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  res.status(200).json(await notificationService.listNotifications(req.user!.id, parsed.data));
}

export async function markRead(req: Request, res: Response) {
  const notification = await notificationService.markRead(req.user!.id, req.params.id as string);
  res.status(200).json({ notification });
}

export async function readAll(req: Request, res: Response) {
  res.status(200).json(await notificationService.markAllRead(req.user!.id));
}

export async function remove(req: Request, res: Response) {
  await notificationService.deleteNotification(req.user!.id, req.params.id as string);
  res.status(204).send();
}
