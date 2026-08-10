import type { NotificationType, Prisma } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/api-error';
import type { ListNotificationsQuery } from './notification.schemas';

// In-app notifications. Creation is ALWAYS fire-and-forget from trigger sites —
// a notification must never slow down or break the action that caused it, so use
// notify() (which swallows errors) rather than awaiting createNotification.

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}

async function createNotification(input: NotifyInput) {
  await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      data: input.data ? (input.data as Prisma.InputJsonValue) : undefined,
    },
  });
}

// Fire-and-forget entry point for triggers. Never throws, never awaited.
export function notify(input: NotifyInput): void {
  void createNotification(input).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[notifications] failed (${input.type} → ${input.userId}): ${msg}`);
  });
}

export async function listNotifications(userId: string, query: ListNotificationsQuery) {
  const { unread, page, limit } = query;
  const where = { userId, ...(unread ? { readAt: null } : {}) };

  const [total, unreadCount, notifications] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    unreadCount,
    notifications,
  };
}

// Resolve a notification and assert it belongs to the caller (else 404, so we
// never reveal that someone else's id exists).
async function getOwned(userId: string, id: string) {
  const n = await prisma.notification.findUnique({ where: { id } });
  if (!n || n.userId !== userId) {
    throw ApiError.notFound('Notification not found');
  }
  return n;
}

export async function markRead(userId: string, id: string) {
  const n = await getOwned(userId, id);
  if (n.readAt) return n; // idempotent
  return prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
}

export async function markAllRead(userId: string) {
  const res = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: res.count };
}

export async function deleteNotification(userId: string, id: string) {
  const n = await getOwned(userId, id);
  await prisma.notification.delete({ where: { id: n.id } });
}
