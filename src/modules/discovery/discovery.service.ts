import { prisma } from '../../lib/prisma';
import * as aiService from '../../lib/ai/ai.service';
import { ApiError } from '../../utils/api-error';
import { getProject } from '../projects/project.service';
import { discoveryQuestions, getQuestion } from './questions';
import type { SubmitAnswerInput } from './discovery.schemas';

// Shape of the JSONB `answer` column on DiscoveryAnswer.
interface AnswerPayload {
  text: string;
  followUp?: {
    question: string;
    answer: string | null;
  };
}

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

  // Preserve any AI follow-up already attached to this answer; a revised
  // main answer or a followUpAnswer submission updates the JSONB in place.
  const existing = await prisma.discoveryAnswer.findUnique({
    where: { sessionId_questionId: { sessionId: session.id, questionId: question.id } },
  });
  const existingPayload = (existing?.answer ?? {}) as Partial<AnswerPayload>;

  const payload: AnswerPayload = {
    text: input.answer,
    ...(existingPayload.followUp
      ? {
          followUp: {
            question: existingPayload.followUp.question,
            answer: input.followUpAnswer ?? existingPayload.followUp.answer ?? null,
          },
        }
      : {}),
  };

  // Upsert on the (sessionId, questionId) unique pair: first submission
  // creates the answer, resubmitting the same question revises it.
  await prisma.discoveryAnswer.upsert({
    where: { sessionId_questionId: { sessionId: session.id, questionId: question.id } },
    create: {
      sessionId: session.id,
      questionId: question.id,
      questionText: question.text,
      module: question.module,
      answer: { ...payload },
    },
    update: { answer: { ...payload }, answeredAt: new Date() },
  });

  const answers = await prisma.discoveryAnswer.findMany({
    where: { sessionId: session.id },
    select: { questionId: true },
  });
  return buildProgress(new Set(answers.map((a) => a.questionId)));
}

// The signature move: after a founder answers an anchor question, the AI
// reads the answer in the project's context and asks ONE sharper follow-up —
// stored in the answer's JSONB, so no schema change was needed.
export async function generateFollowUp(userId: string, projectId: string, questionId: string) {
  const project = await getProject(userId, projectId);

  const session = await prisma.discoverySession.findUnique({ where: { projectId } });
  if (!session) {
    throw ApiError.notFound('No discovery session for this project yet');
  }
  if (session.status !== 'ACTIVE') {
    throw ApiError.badRequest('This session is closed — follow-ups are only for active interviews');
  }

  const question = getQuestion(questionId);
  if (!question) {
    throw ApiError.badRequest(`Unknown questionId: ${questionId}`);
  }

  const answerRow = await prisma.discoveryAnswer.findUnique({
    where: { sessionId_questionId: { sessionId: session.id, questionId } },
  });
  if (!answerRow) {
    throw ApiError.badRequest('Answer this question first — follow-ups react to your answer');
  }

  const payload = answerRow.answer as unknown as AnswerPayload;

  const followUpQuestion = await aiService.generateText({
    feature: 'discovery.follow_up',
    userId,
    projectId,
    maxTokens: 2048,
    system:
      'You are the discovery interviewer inside Fritlow, a product operating system that turns ' +
      'founder ideas into build-ready plans. Your persona: an experienced, candid product strategist. ' +
      'Given one interview question and the founder\'s answer, ask exactly ONE follow-up question that ' +
      'digs into the weakest or vaguest part of the answer. Challenge gently but honestly — if the ' +
      'answer says "everyone" or hand-waves evidence, push on that. Reply with ONLY the follow-up ' +
      'question itself: one or two sentences, no preamble, no numbering, no quotation marks.',
    prompt: [
      `Project: ${project.name}`,
      `One-line idea: ${project.oneLineIdea}`,
      project.category ? `Category: ${project.category}` : null,
      '',
      `Interview question (module: ${question.module}): ${question.text}`,
      `Founder's answer: ${payload.text}`,
    ]
      .filter((line) => line !== null)
      .join('\n'),
  });

  await prisma.discoveryAnswer.update({
    where: { id: answerRow.id },
    data: {
      answer: { text: payload.text, followUp: { question: followUpQuestion, answer: null } },
    },
  });

  return { questionId, followUp: followUpQuestion };
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
