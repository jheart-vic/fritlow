import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/api-error';
import { planTotal } from '../discovery/questions';
import type { CreateProjectInput, ListProjectsQuery, UpdateProjectInput } from './project.schemas';

// Tenancy rules enforced here (and only here):
//  - you can only see/touch projects in workspaces you are a member of
//  - deleting a project requires OWNER or ADMIN role in its workspace

// Embedded in every project response so the UI can show WHO created it
// without a second request. Deliberately tiny — never the full user row.
const createdBySelect = {
  createdBy: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
} as const;

// Returns the member row if the user belongs to the workspace, else 403.
// Every service function that touches a project goes through this gate.
async function assertMembership(userId: string, workspaceId: string) {
  const member = await prisma.workspaceMember.findUnique({
    // Prisma names this compound-unique lookup after the @@unique fields.
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  if (!member) {
    throw ApiError.forbidden('You are not a member of this workspace');
  }
  return member;
}

// The user's personal workspace — the private one created at registration,
// flagged with isPersonal. Projects created without an explicit workspaceId
// land here.
async function getPersonalWorkspaceId(userId: string): Promise<string> {
  const personal = await prisma.workspace.findFirst({
    where: { isPersonal: true, members: { some: { userId, role: 'OWNER' } } },
    select: { id: true },
  });
  if (personal) return personal.id;

  // Fallback for any account the isPersonal backfill didn't reach: the old
  // rule, "the earliest workspace you own".
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId, role: 'OWNER' },
    orderBy: { createdAt: 'asc' },
  });
  if (!membership) {
    throw ApiError.notFound('No personal workspace found for this user');
  }
  return membership.workspaceId;
}

export async function createProject(userId: string, input: CreateProjectInput) {
  const workspaceId = input.workspaceId ?? (await getPersonalWorkspaceId(userId));
  await assertMembership(userId, workspaceId);

  return prisma.project.create({
    data: {
      name: input.name,
      oneLineIdea: input.oneLineIdea,
      category: input.category,
      workspaceId,
      createdById: userId,
    },
    include: createdBySelect,
  });
}

export async function listProjects(userId: string, query: ListProjectsQuery) {
  // Asking for one workspace you don't belong to is an error, not an empty
  // list — silently returning [] would look like "this workspace is empty".
  if (query.workspaceId) {
    await assertMembership(userId, query.workspaceId);
  }

  // "Projects in any workspace that has a member row for me" — Prisma
  // turns this nested filter into a SQL join, no manual IN-list needed.
  // With workspaceId set, that narrows to the single workspace.
  const projects = await prisma.project.findMany({
    where: {
      workspace: { members: { some: { userId } } },
      ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
      ...(query.status ? { status: query.status } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      ...createdBySelect,
      // Enough to compute the per-project discovery progress bar (parity with
      // the dashboard cards), without pulling every answer row.
      discoverySession: {
        select: { questionPlan: true, _count: { select: { answers: true } } },
      },
    },
  });

  // Flatten the session into a small `discoveryProgress` field and drop the raw
  // relation from the response.
  return projects.map(({ discoverySession, ...project }) => ({
    ...project,
    discoveryProgress: discoverySession
      ? { answered: discoverySession._count.answers, total: planTotal(discoverySession.questionPlan) }
      : null,
  }));
}

export async function getProject(userId: string, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: createdBySelect,
  });
  if (!project) {
    throw ApiError.notFound('Project not found');
  }
  await assertMembership(userId, project.workspaceId);
  return project;
}

export async function updateProject(userId: string, projectId: string, input: UpdateProjectInput) {
  // getProject already runs the membership check.
  const project = await getProject(userId, projectId);

  // Moving a project between workspaces is not an ordinary field edit: it
  // hands the project to a different set of people and takes it away from the
  // current ones. So it carries the same bar as deleting — OWNER/ADMIN — on
  // BOTH sides: on the source because members there lose access, on the
  // destination because members there gain it.
  if (input.workspaceId && input.workspaceId !== project.workspaceId) {
    const from = await assertMembership(userId, project.workspaceId);
    if (from.role !== 'OWNER' && from.role !== 'ADMIN') {
      throw ApiError.forbidden(
        'Only workspace owners or admins can move a project out of a workspace',
      );
    }

    const to = await assertMembership(userId, input.workspaceId);
    if (to.role !== 'OWNER' && to.role !== 'ADMIN') {
      throw ApiError.forbidden(
        'Only workspace owners or admins can move a project into a workspace',
      );
    }
  }

  return prisma.project.update({
    where: { id: project.id },
    data: input,
    include: createdBySelect,
  });
}

export async function deleteProject(userId: string, projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw ApiError.notFound('Project not found');
  }

  const member = await assertMembership(userId, project.workspaceId);
  if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
    throw ApiError.forbidden('Only workspace owners or admins can delete projects');
  }

  await prisma.project.delete({ where: { id: project.id } });
}
