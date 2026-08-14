import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/api-error';
import { planTotal } from '../discovery/questions';
import { notify } from '../notifications/notification.service';
import type {
  CreateProjectInput,
  ListProjectsQuery,
  MoveProjectsInput,
  UpdateProjectInput,
} from './project.schemas';

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

// Where a project lands when the caller doesn't name a workspace.
//
// This reads an explicit pointer (User.defaultWorkspaceId) rather than
// inferring one from isPrivate. Inference only worked while a user could have
// exactly one private workspace; now that they may have several — or none —
// "which one is the default?" has to be a stated fact, not a guess.
//
// The pointer is nullable (SetNull when the workspace is deleted), so a user
// can legitimately have none. That is a 400, not a silent fallback to some
// other workspace they own: quietly choosing for them is how projects end up
// in a shared space nobody meant to publish them to.
async function getDefaultWorkspaceId(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { defaultWorkspaceId: true },
  });
  if (!user?.defaultWorkspaceId) {
    throw ApiError.badRequest(
      'You have no default workspace — choose which workspace this project belongs to, ' +
        'or set a default first.',
    );
  }
  return user.defaultWorkspaceId;
}

// Who a move takes access away from, and who it gives access to.
//
// Membership is workspace-wide, so moving a project is really a transfer of
// audience: everyone in the source who is NOT also in the destination loses
// sight of it, and everyone in the destination who was not in the source gains
// it. Computing the SET DIFFERENCE (rather than "everyone in the source")
// matters — people who belong to both workspaces notice nothing, and telling
// them they lost access would be a lie.
async function getAccessDelta(fromWorkspaceId: string, toWorkspaceId: string) {
  const [fromMembers, toMembers] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId: fromWorkspaceId },
      select: { userId: true },
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId: toWorkspaceId },
      select: { userId: true },
    }),
  ]);

  const toIds = new Set(toMembers.map((m) => m.userId));
  const fromIds = new Set(fromMembers.map((m) => m.userId));

  return {
    losingAccess: fromMembers.map((m) => m.userId).filter((id) => !toIds.has(id)),
    gainingAccess: toMembers.map((m) => m.userId).filter((id) => !fromIds.has(id)),
  };
}

// Tell the people a move cut off. Without this a move is completely silent —
// the project just disappears from their dashboard with no explanation.
//
// The destination workspace is deliberately NOT named: they have no access to
// it, and naming a workspace someone cannot see leaks its existence. "Moved out
// of <source> by <actor>" is everything they can act on.
function notifyAccessLost(
  userIds: string[],
  details: { actorName: string; fromWorkspaceName: string; projectName?: string; projectCount: number },
) {
  const { actorName, fromWorkspaceName, projectName, projectCount } = details;
  const subject =
    projectCount === 1 && projectName ? `"${projectName}"` : `${projectCount} projects`;

  for (const userId of userIds) {
    notify({
      userId,
      type: 'PROJECT_MOVED',
      title: `${subject} left ${fromWorkspaceName}`,
      body: `${actorName} moved ${projectCount === 1 ? 'it' : 'them'} to another workspace. You no longer have access.`,
      // No projectId in the payload — the click-through would 403. The
      // workspace they still belong to is the only useful destination.
      data: { workspaceId: null, fromWorkspaceName },
    });
  }
}

export async function createProject(userId: string, input: CreateProjectInput) {
  const workspaceId = input.workspaceId ?? (await getDefaultWorkspaceId(userId));
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
  const isMove = Boolean(input.workspaceId && input.workspaceId !== project.workspaceId);

  if (isMove) {
    await assertCanMove(userId, project.workspaceId, input.workspaceId!);
  }

  // Read the membership delta BEFORE the update, while the project still
  // belongs to the source — afterwards there is no record of who could see it.
  const delta = isMove ? await getAccessDelta(project.workspaceId, input.workspaceId!) : null;

  const updated = await prisma.project.update({
    where: { id: project.id },
    data: input,
    include: createdBySelect,
  });

  if (isMove && delta) {
    const [actor, fromWorkspace] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
      prisma.workspace.findUnique({ where: { id: project.workspaceId }, select: { name: true } }),
    ]);

    notifyAccessLost(
      // Never notify the person who did it — they know.
      delta.losingAccess.filter((id) => id !== userId),
      {
        actorName: actor?.fullName ?? 'Someone',
        fromWorkspaceName: fromWorkspace?.name ?? 'a workspace',
        projectName: project.name,
        projectCount: 1,
      },
    );
  }

  return updated;
}

// The permission bar for moving a project, applied on BOTH sides: OWNER/ADMIN
// in the source (its members lose access) and in the destination (its members
// gain it). Same bar as deleting, because a move is a deletion from one
// audience's point of view.
async function assertCanMove(userId: string, fromWorkspaceId: string, toWorkspaceId: string) {
  const from = await assertMembership(userId, fromWorkspaceId);
  if (from.role !== 'OWNER' && from.role !== 'ADMIN') {
    throw ApiError.forbidden(
      'Only workspace owners or admins can move a project out of a workspace',
    );
  }

  const to = await assertMembership(userId, toWorkspaceId);
  if (to.role !== 'OWNER' && to.role !== 'ADMIN') {
    throw ApiError.forbidden('Only workspace owners or admins can move a project into a workspace');
  }
}

// What a move WOULD do, for the confirmation dialog. Computed server-side so
// the number the user is shown and the number the move acts on cannot drift
// apart — and so the UI doesn't have to fetch two member lists to subtract.
export async function previewMove(userId: string, projectId: string, toWorkspaceId: string) {
  // Query params are untyped at the edge; without this an omitted workspaceId
  // reaches Prisma as undefined and surfaces as an opaque 500.
  if (!toWorkspaceId) {
    throw ApiError.badRequest('workspaceId query parameter is required (the destination workspace)');
  }

  const project = await getProject(userId, projectId);

  if (project.workspaceId === toWorkspaceId) {
    throw ApiError.badRequest('That project is already in this workspace');
  }
  await assertCanMove(userId, project.workspaceId, toWorkspaceId);

  const delta = await getAccessDelta(project.workspaceId, toWorkspaceId);
  const losing = delta.losingAccess.filter((id) => id !== userId);
  const gaining = delta.gainingAccess.filter((id) => id !== userId);

  const [from, to, losingUsers] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: project.workspaceId }, select: { id: true, name: true } }),
    prisma.workspace.findUnique({ where: { id: toWorkspaceId }, select: { id: true, name: true } }),
    // Named, so the dialog can say who — a list of faces lands harder than
    // "3 people" when the point is to make the consequence concrete.
    prisma.user.findMany({
      where: { id: { in: losing } },
      select: { id: true, fullName: true, avatarUrl: true },
    }),
  ]);

  return {
    project: { id: project.id, name: project.name },
    from,
    to,
    losingAccess: { count: losing.length, users: losingUsers },
    gainingAccess: { count: gaining.length },
  };
}

// Load the requested projects and check the caller may move every one of them.
// Shared by the bulk move and its preview so the two can never disagree about
// what is permitted.
async function resolveBulkMove(userId: string, projectIds: string[], targetWorkspaceId: string) {
  // Dedupe: the same id listed twice would otherwise double every count.
  const ids = [...new Set(projectIds)];

  const projects = await prisma.project.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, workspaceId: true },
  });

  // Report the whole gap at once rather than failing on the first bad id —
  // one round trip is enough for the UI to explain what went wrong.
  if (projects.length !== ids.length) {
    const found = new Set(projects.map((p) => p.id));
    const missing = ids.filter((id) => !found.has(id));
    throw ApiError.notFound(`Project not found: ${missing.join(', ')}`);
  }

  const alreadyThere = projects.filter((p) => p.workspaceId === targetWorkspaceId);
  if (alreadyThere.length > 0) {
    throw ApiError.badRequest(
      `Already in that workspace: ${alreadyThere.map((p) => p.name).join(', ')}`,
    );
  }

  // A selection can span several source workspaces — the dashboard lists
  // projects from all of them together, so a multi-select naturally does too.
  // Every distinct source needs the permission check, not just the first.
  const sourceIds = [...new Set(projects.map((p) => p.workspaceId))];
  for (const sourceId of sourceIds) {
    await assertCanMove(userId, sourceId, targetWorkspaceId);
  }

  return { projects, sourceIds };
}

// Move a batch of projects into one workspace.
//
// All-or-nothing: a half-finished move leaves the user with projects scattered
// across two workspaces and no clear way to tell which made it, so the whole
// batch shares a transaction.
export async function moveProjects(userId: string, input: MoveProjectsInput) {
  const { projects, sourceIds } = await resolveBulkMove(
    userId,
    input.projectIds,
    input.targetWorkspaceId,
  );

  // Deltas per source workspace, read before the move while the memberships
  // still describe who could see these projects.
  const deltas = await Promise.all(
    sourceIds.map(async (sourceId) => ({
      sourceId,
      ...(await getAccessDelta(sourceId, input.targetWorkspaceId)),
      projectCount: projects.filter((p) => p.workspaceId === sourceId).length,
    })),
  );

  await prisma.$transaction(
    async (tx) => {
      await tx.project.updateMany({
        where: { id: { in: projects.map((p) => p.id) } },
        data: { workspaceId: input.targetWorkspaceId },
      });
    },
    { maxWait: 10000, timeout: 15000 },
  );

  const [actor, workspaces] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
    prisma.workspace.findMany({ where: { id: { in: sourceIds } }, select: { id: true, name: true } }),
  ]);
  const nameById = new Map(workspaces.map((w) => [w.id, w.name]));

  // One notification per affected person per source workspace, naming the
  // count — not one per project. Someone who loses sight of twelve projects
  // should get a single "12 projects left Acme", not twelve separate alerts.
  for (const delta of deltas) {
    const single = delta.projectCount === 1
      ? projects.find((p) => p.workspaceId === delta.sourceId)?.name
      : undefined;

    notifyAccessLost(
      delta.losingAccess.filter((id) => id !== userId),
      {
        actorName: actor?.fullName ?? 'Someone',
        fromWorkspaceName: nameById.get(delta.sourceId) ?? 'a workspace',
        ...(single ? { projectName: single } : {}),
        projectCount: delta.projectCount,
      },
    );
  }

  return {
    movedCount: projects.length,
    targetWorkspaceId: input.targetWorkspaceId,
    projectIds: projects.map((p) => p.id),
  };
}

// What a bulk move would do, for its confirmation dialog. Aggregates the
// per-source deltas into one "N people lose access" figure — a person who
// belongs to two of the source workspaces is counted once.
export async function previewMoveProjects(userId: string, input: MoveProjectsInput) {
  const { projects, sourceIds } = await resolveBulkMove(
    userId,
    input.projectIds,
    input.targetWorkspaceId,
  );

  const losing = new Set<string>();
  const gaining = new Set<string>();
  for (const sourceId of sourceIds) {
    const delta = await getAccessDelta(sourceId, input.targetWorkspaceId);
    delta.losingAccess.forEach((id) => id !== userId && losing.add(id));
    delta.gainingAccess.forEach((id) => id !== userId && gaining.add(id));
  }

  const [losingUsers, to, sources] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: [...losing] } },
      select: { id: true, fullName: true, avatarUrl: true },
    }),
    prisma.workspace.findUnique({
      where: { id: input.targetWorkspaceId },
      select: { id: true, name: true },
    }),
    prisma.workspace.findMany({ where: { id: { in: sourceIds } }, select: { id: true, name: true } }),
  ]);

  return {
    projectCount: projects.length,
    from: sources,
    to,
    losingAccess: { count: losing.size, users: losingUsers },
    gainingAccess: { count: gaining.size },
  };
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
