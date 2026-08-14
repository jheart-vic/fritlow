import { prisma } from '../../lib/prisma';
import { planTotal } from '../discovery/questions';

// The dashboard's design north star: answer "what should I do next?" in
// three seconds. This service computes exactly one recommended action per
// project, and one overall — pure logic, no AI.

export interface NextAction {
  type:
    | 'START_DISCOVERY'
    | 'CONTINUE_DISCOVERY'
    | 'COMPLETE_DISCOVERY'
    | 'GENERATE_BLUEPRINT'
    | 'REVIEW_BLUEPRINT'
    | 'CELEBRATE';
  label: string;
  projectId: string;
}

interface DashboardProject {
  id: string;
  name: string;
  oneLineIdea: string;
  status: string;
  updatedAt: Date;
  discoveryProgress: { answered: number; total: number } | null;
  hasBlueprint: boolean;
  nextAction: NextAction;
  // Which workspace this project lives in. The dashboard aggregates across
  // every workspace the caller belongs to, so without this a collaborator sees
  // their own drafts and four clients' projects in one undifferentiated list —
  // and a project appearing there the day they accept an invite reads as a
  // leak rather than the access they were granted.
  workspace: { id: string; name: string; isPrivate: boolean };
  // Did the caller create this? Drives the headline recommendation.
  isMine: boolean;
}

function buildNextAction(project: {
  id: string;
  status: string;
  session: { status: string; answeredCount: number; total: number } | null;
  hasBlueprint: boolean;
}): NextAction {
  if (!project.session) {
    return { type: 'START_DISCOVERY', label: 'Start the discovery interview', projectId: project.id };
  }
  if (project.session.status === 'ACTIVE') {
    const { answeredCount, total } = project.session;
    return answeredCount < total
      ? {
          type: 'CONTINUE_DISCOVERY',
          label: `Continue the interview (${answeredCount}/${total} answered)`,
          projectId: project.id,
        }
      : { type: 'COMPLETE_DISCOVERY', label: 'Wrap up the interview — all questions answered', projectId: project.id };
  }
  if (!project.hasBlueprint) {
    return { type: 'GENERATE_BLUEPRINT', label: 'Generate your blueprint', projectId: project.id };
  }
  if (project.status !== 'LAUNCHED') {
    return { type: 'REVIEW_BLUEPRINT', label: 'Review and refine your blueprint', projectId: project.id };
  }
  return { type: 'CELEBRATE', label: 'Launched — keep iterating', projectId: project.id };
}

export async function getDashboard(
  userId: string,
  // Optional narrowing to one workspace, matching what listProjects accepts.
  // Without it the dashboard spans every workspace the caller belongs to.
  workspaceId?: string,
): Promise<{
  projects: DashboardProject[];
  nextAction: NextAction | null;
}> {
  const projects = await prisma.project.findMany({
    where: {
      workspace: { members: { some: { userId } } },
      ...(workspaceId ? { workspaceId } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      discoverySession: {
        select: { status: true, questionPlan: true, _count: { select: { answers: true } } },
      },
      blueprint: { select: { id: true } },
      workspace: { select: { id: true, name: true, isPrivate: true } },
    },
  });

  const dashboardProjects: DashboardProject[] = projects.map((p) => {
    // Total question count is per-project now (the session's tailored plan).
    // Legacy sessions with no stored plan fall back to the core-question count.
    const total = planTotal(p.discoverySession?.questionPlan);
    const session = p.discoverySession
      ? { status: p.discoverySession.status, answeredCount: p.discoverySession._count.answers, total }
      : null;
    return {
      id: p.id,
      name: p.name,
      oneLineIdea: p.oneLineIdea,
      status: p.status,
      updatedAt: p.updatedAt,
      discoveryProgress: session
        ? { answered: session.answeredCount, total: session.total }
        : null,
      hasBlueprint: Boolean(p.blueprint),
      nextAction: buildNextAction({
        id: p.id,
        status: p.status,
        session,
        hasBlueprint: Boolean(p.blueprint),
      }),
      workspace: p.workspace,
      isMine: p.createdById === userId,
    };
  });

  // "Continue where you left off" — biased to the caller's OWN most recently
  // touched project, falling back to recency across everything they can see.
  //
  // Pure recency breaks for collaborators: someone who joins a busy workspace
  // opens Fritlow and the headline tells them to continue a teammate's
  // discovery interview, because that teammate edited it ten minutes ago.
  // Correct by permissions, wrong by intent — the dashboard's job is "what
  // should *I* do next?". Projects stay sorted by recency regardless; this
  // only picks the one action promoted to the banner.
  const headline =
    dashboardProjects.find((p) => p.isMine) ?? dashboardProjects[0];

  return {
    projects: dashboardProjects,
    nextAction: headline?.nextAction ?? null,
  };
}
