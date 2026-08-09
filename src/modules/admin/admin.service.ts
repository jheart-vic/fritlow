import type { ProjectStatus } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/api-error';
import type { ListUsersQuery } from './admin.schemas';

// The Fritlow-internal admin surface: platform-wide monitoring of users,
// projects, and engagement. Read-only for now. Everything here assumes the
// caller has already passed requirePlatformRole — there is NO tenancy scoping,
// this deliberately sees across all workspaces.

// The anonymization placeholder from account deletion isn't a real user — keep
// it out of every count and listing so the numbers reflect actual people.
const SENTINEL_EMAIL = 'deleted-user@fritlow.internal';
const notSentinel = { email: { not: SENTINEL_EMAIL } } as const;

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

export async function getStats() {
  const since7 = daysAgo(7);
  const since30 = daysAgo(30);

  const [
    totalUsers,
    verifiedUsers,
    newUsers7,
    newUsers30,
    totalWorkspaces,
    totalProjects,
    projectsByStatusRaw,
    discoveryTotal,
    discoveryCompleted,
    blueprintsReady,
    recommendationsTotal,
    exportsTotal,
    activeProjects7,
  ] = await Promise.all([
    prisma.user.count({ where: notSentinel }),
    prisma.user.count({ where: { ...notSentinel, emailVerifiedAt: { not: null } } }),
    prisma.user.count({ where: { ...notSentinel, createdAt: { gte: since7 } } }),
    prisma.user.count({ where: { ...notSentinel, createdAt: { gte: since30 } } }),
    prisma.workspace.count(),
    prisma.project.count(),
    prisma.project.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.discoverySession.count(),
    prisma.discoverySession.count({ where: { status: 'COMPLETED' } }),
    prisma.blueprint.count({ where: { status: 'READY' } }),
    prisma.recommendation.count(),
    prisma.export.count(),
    // Engagement proxy: projects touched in the last 7 days. We have no
    // product-analytics events table yet, so this stands in for "active".
    prisma.project.count({ where: { updatedAt: { gte: since7 } } }),
  ]);

  const byStatus: Record<ProjectStatus, number> = {
    DRAFT: 0,
    DISCOVERY: 0,
    BLUEPRINT_COMPLETE: 0,
    LAUNCHED: 0,
  };
  for (const row of projectsByStatusRaw) byStatus[row.status] = row._count._all;

  return {
    users: {
      total: totalUsers,
      verified: verifiedUsers,
      newLast7Days: newUsers7,
      newLast30Days: newUsers30,
    },
    workspaces: { total: totalWorkspaces },
    projects: { total: totalProjects, byStatus, activeLast7Days: activeProjects7 },
    discovery: {
      sessions: discoveryTotal,
      completed: discoveryCompleted,
      completionRate: discoveryTotal ? Math.round((discoveryCompleted / discoveryTotal) * 100) : 0,
    },
    blueprints: { generated: blueprintsReady },
    recommendations: { total: recommendationsTotal },
    exports: { total: exportsTotal },
    generatedAt: new Date().toISOString(),
    note: 'engagement metrics are timestamp-derived proxies; no analytics-events table yet',
  };
}

// Shared serializer so list + detail expose the same user shape.
function serializeUser(u: {
  id: string;
  email: string;
  fullName: string;
  emailVerifiedAt: Date | null;
  platformRole: string;
  createdAt: Date;
}) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    emailVerified: u.emailVerifiedAt !== null,
    platformRole: u.platformRole,
    createdAt: u.createdAt,
  };
}

export async function listUsers(query: ListUsersQuery) {
  const { page, limit, q } = query;
  const where = {
    ...notSentinel,
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' as const } },
            { fullName: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        email: true,
        fullName: true,
        emailVerifiedAt: true,
        platformRole: true,
        createdAt: true,
        _count: { select: { createdProjects: true, memberships: true } },
      },
    }),
  ]);

  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    users: rows.map((u) => ({
      ...serializeUser(u),
      projectCount: u._count.createdProjects,
      workspaceCount: u._count.memberships,
    })),
  };
}

export async function getUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      emailVerifiedAt: true,
      platformRole: true,
      createdAt: true,
      memberships: {
        select: {
          role: true,
          createdAt: true,
          workspace: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      createdProjects: {
        select: { id: true, name: true, status: true, workspaceId: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      },
    },
  });
  if (!user) {
    throw ApiError.notFound('User not found');
  }

  const lastActivity = user.createdProjects.reduce<Date | null>(
    (latest, p) => (!latest || p.updatedAt > latest ? p.updatedAt : latest),
    null,
  );

  return {
    ...serializeUser(user),
    workspaces: user.memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      role: m.role,
      joinedAt: m.createdAt,
    })),
    projects: user.createdProjects,
    activity: {
      projectCount: user.createdProjects.length,
      lastProjectActivityAt: lastActivity,
    },
  };
}
