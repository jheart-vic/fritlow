import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/api-error';
import type { CreateProjectInput, ListProjectsQuery, UpdateProjectInput } from './project.schemas';

// Tenancy rules enforced here (and only here):
//  - you can only see/touch projects in workspaces you are a member of
//  - deleting a project requires OWNER or ADMIN role in its workspace

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

// The user's personal workspace = the one they OWN (created at registration).
async function getPersonalWorkspaceId(userId: string): Promise<string> {
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
  });
}

export async function listProjects(userId: string, query: ListProjectsQuery) {
  // "Projects in any workspace that has a member row for me" — Prisma
  // turns this nested filter into a SQL join, no manual IN-list needed.
  return prisma.project.findMany({
    where: {
      workspace: { members: { some: { userId } } },
      ...(query.status ? { status: query.status } : {}),
    },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function getProject(userId: string, projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw ApiError.notFound('Project not found');
  }
  await assertMembership(userId, project.workspaceId);
  return project;
}

export async function updateProject(userId: string, projectId: string, input: UpdateProjectInput) {
  // getProject already runs the membership check.
  const project = await getProject(userId, projectId);

  return prisma.project.update({
    where: { id: project.id },
    data: input,
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
