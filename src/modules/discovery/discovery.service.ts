import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/api-error';
import { getProject } from '../projects/project.service';
import { discoveryQuestions, getQuestion } from './questions';
import type { SubmitAnswerInput } from './discovery.schemas';

// getProject (from the projects service) doubles as the access gate here:
// it 404s on unknown projects and 403s non-members before anything runs.

// Progress = which anchor questions have answers. The next question is the
// first unanswered one, in bank order — deterministic and resumable.
function buildProgress(answeredIds: Set<string>) {
  const next = discoveryQuestions.find((q) => !answeredIds.has(q.id)) ?? null;
  return {
    answered: answeredIds.size,
    total: discoveryQuestions.length,
    nextQuestion: next,
  };
}

export async function startSession(userId: string, projectId: string) {
  const project = await getProject(userId, projectId);

  const existing = await prisma.discoverySession.findUnique({ where: { projectId } });
  if (existing) {
    throw ApiError.conflict('This project already has a discovery session');
  }

  // Creating the session moves the project into DISCOVERY — one transaction,
  // so the session and the status flip can't disagree.
  const [session] = await prisma.$transaction([
    prisma.discoverySession.create({ data: { projectId } }),
    prisma.project.update({ where: { id: project.id }, data: { status: 'DISCOVERY' } }),
  ]);

  return { session, ...buildProgress(new Set()) };
}

export async function getSession(userId: string, projectId: string) {
  await getProject(userId, projectId);

  const session = await prisma.discoverySession.findUnique({
    where: { projectId },
    include: { answers: { orderBy: { answeredAt: 'asc' } } },
  });
  if (!session) {
    throw ApiError.notFound('No discovery session for this project yet');
  }

  const answeredIds = new Set(session.answers.map((a) => a.questionId));
  return { session, ...buildProgress(answeredIds) };
}

export async function submitAnswer(userId: string, projectId: string, input: SubmitAnswerInput) {
  await getProject(userId, projectId);

  const session = await prisma.discoverySession.findUnique({ where: { projectId } });
  if (!session) {
    throw ApiError.notFound('No discovery session for this project yet');
  }
  if (session.status !== 'ACTIVE') {
    throw ApiError.badRequest(`This session is ${session.status.toLowerCase()} — answers are closed`);
  }

  const question = getQuestion(input.questionId);
  if (!question) {
    throw ApiError.badRequest(`Unknown questionId: ${input.questionId}`);
  }

  // Upsert on the (sessionId, questionId) unique pair: first submission
  // creates the answer, resubmitting the same question revises it.
  await prisma.discoveryAnswer.upsert({
    where: { sessionId_questionId: { sessionId: session.id, questionId: question.id } },
    create: {
      sessionId: session.id,
      questionId: question.id,
      questionText: question.text,
      module: question.module,
      answer: { text: input.answer },
    },
    update: { answer: { text: input.answer }, answeredAt: new Date() },
  });

  const answers = await prisma.discoveryAnswer.findMany({
    where: { sessionId: session.id },
    select: { questionId: true },
  });
  return buildProgress(new Set(answers.map((a) => a.questionId)));
}

export async function completeSession(userId: string, projectId: string) {
  await getProject(userId, projectId);

  const session = await prisma.discoverySession.findUnique({
    where: { projectId },
    include: { answers: { select: { questionId: true } } },
  });
  if (!session) {
    throw ApiError.notFound('No discovery session for this project yet');
  }
  if (session.status !== 'ACTIVE') {
    throw ApiError.badRequest('This session is already closed');
  }

  const answeredIds = new Set(session.answers.map((a) => a.questionId));
  const unanswered = discoveryQuestions.filter((q) => !answeredIds.has(q.id));
  if (unanswered.length > 0) {
    throw ApiError.badRequest(
      `Cannot complete: ${unanswered.length} question(s) unanswered (next: "${unanswered[0]!.id}")`,
    );
  }

  return prisma.discoverySession.update({
    where: { id: session.id },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
}
