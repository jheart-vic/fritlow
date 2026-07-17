import { prisma } from '../../lib/prisma';
import { discoveryQuestions } from '../discovery/questions';

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
}

function buildNextAction(project: {
  id: string;
  status: string;
  session: { status: string; answeredCount: number } | null;
  hasBlueprint: boolean;
}): NextAction {
  const total = discoveryQuestions.length;

  if (!project.session) {
    return { type: 'START_DISCOVERY', label: 'Start the discovery interview', projectId: project.id };
  }
  if (project.session.status === 'ACTIVE') {
    const { answeredCount } = project.session;
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

export async function getDashboard(userId: string): Promise<{
  projects: DashboardProject[];
  nextAction: NextAction | null;
}> {
  const projects = await prisma.project.findMany({
    where: { workspace: { members: { some: { userId } } } },
    orderBy: { updatedAt: 'desc' },
    include: {
      discoverySession: {
        select: { status: true, _count: { select: { answers: true } } },
      },
      blueprint: { select: { id: true } },
    },
  });

  const dashboardProjects: DashboardProject[] = projects.map((p) => {
    const session = p.discoverySession
      ? { status: p.discoverySession.status, answeredCount: p.discoverySession._count.answers }
      : null;
    return {
      id: p.id,
      name: p.name,
      oneLineIdea: p.oneLineIdea,
      status: p.status,
      updatedAt: p.updatedAt,
      discoveryProgress: session
        ? { answered: session.answeredCount, total: discoveryQuestions.length }
        : null,
      hasBlueprint: Boolean(p.blueprint),
      nextAction: buildNextAction({
        id: p.id,
        status: p.status,
        session,
        hasBlueprint: Boolean(p.blueprint),
      }),
    };
  });

  // "Continue where you left off" = the most recently touched project.
  return {
    projects: dashboardProjects,
    nextAction: dashboardProjects[0]?.nextAction ?? null,
  };
}
