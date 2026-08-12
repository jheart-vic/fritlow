import type { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';
import * as aiService from '../../lib/ai/ai.service';
import { ApiError } from '../../utils/api-error';
import { getProject } from '../projects/project.service';
import { triggerRecommendations } from '../recommendations/recommendation.service';
import { getExtractedDocuments } from '../documents/document.service';
import { generateQuestionPlan, type PlanQuestion } from './discovery.plan';
import { generatePrefill } from './discovery.prefill';
import { assembleBasePlan, planModules } from './questions';
import type { SubmitAnswerInput } from './discovery.schemas';

// Shape of the JSONB `answer` column on DiscoveryAnswer.
interface AnswerPayload {
  text: string;
  // AI "confidence meter": how specific/complete the answer is (0-100), with a
  // derived band. Null when AI isn't configured or grading failed — answering
  // never depends on AI being available.
  confidence?: number | null;
  confidenceLabel?: ConfidenceLabel | null;
  followUp?: {
    question: string;
    answer: string | null;
  };
  // Provenance. Absent means the founder typed this answer themselves.
  // 'document' means it was drafted from an uploaded PRD/MVP and is waiting on
  // the founder's review — `needsReview` flips to false the moment they submit
  // the question themselves, and completing the interview is blocked until
  // every drafted answer has been through that.
  source?: 'document';
  sourceDocumentId?: string;
  needsReview?: boolean;
}

type ConfidenceLabel = 'LOW' | 'MEDIUM' | 'HIGH';

// The follow-up endpoints rewrite an answer's JSONB wholesale; this carries the
// document provenance across so a follow-up doesn't quietly erase it.
function provenanceOf(payload: AnswerPayload) {
  return payload.source
    ? {
        source: payload.source,
        sourceDocumentId: payload.sourceDocumentId,
        needsReview: payload.needsReview ?? false,
      }
    : {};
}

function confidenceBand(score: number): ConfidenceLabel {
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

// Best-effort AI grade of an answer's specificity/completeness. Returns null on
// any failure (incl. AI not configured) so a submit never fails because of it.
async function gradeAnswerConfidence(
  userId: string,
  projectId: string,
  question: { module: string; text: string },
  answerText: string,
): Promise<{ confidence: number; confidenceLabel: ConfidenceLabel } | null> {
  try {
    const raw = await aiService.generateText({
      feature: 'discovery.confidence',
      userId,
      projectId,
      maxTokens: 1024, // headroom so a reasoning model still emits the number
      system:
        "You grade how specific and complete a founder's answer to a product discovery " +
        'question is, on a 0-100 scale. Vague/generic/hand-wavy answers ("everyone", ' +
        '"we\'ll figure it out later") score low; concrete answers with real, specific ' +
        'detail score high. Respond with ONLY an integer from 0 to 100 — no other text.',
      prompt: `Question (${question.module}): ${question.text}\nAnswer: ${answerText}`,
    });
    const digits = raw.replace(/[^0-9]/g, '').slice(0, 3);
    if (digits.length === 0) return null;
    const confidence = Math.max(0, Math.min(100, parseInt(digits, 10)));
    return { confidence, confidenceLabel: confidenceBand(confidence) };
  } catch {
    return null;
  }
}

// getProject (from the projects service) doubles as the access gate here:
// it 404s on unknown projects and 403s non-members before anything runs.

// The interview questions for a session = its stored per-project plan. Legacy
// sessions (created before plans existed) have a null plan; we fall back to the
// deterministic base plan built from the project's category so they still work.
function resolvePlan(
  session: { questionPlan: unknown },
  project: { category: string | null },
): PlanQuestion[] {
  const stored = session.questionPlan;
  if (Array.isArray(stored) && stored.length > 0) {
    return stored as PlanQuestion[];
  }
  return assembleBasePlan(project.category);
}

// Progress = which plan questions have answers. The next question is the first
// unanswered one, in plan order — deterministic and resumable. The full plan is
// returned too, so the frontend can render the whole interview up front.
function buildProgress(plan: PlanQuestion[], answeredIds: Set<string>) {
  const next = plan.find((q) => !answeredIds.has(q.id)) ?? null;
  return {
    answered: answeredIds.size,
    total: plan.length,
    nextQuestion: next,
    questions: plan,
    // Module breakdown (label, question count, time estimate) for the resume card.
    modules: planModules(plan),
  };
}

export async function startSession(userId: string, projectId: string) {
  const project = await getProject(userId, projectId);

  const existing = await prisma.discoverySession.findUnique({ where: { projectId } });
  if (existing) {
    throw ApiError.conflict('This project already has a discovery session');
  }

  // Build the tailored per-project interview plan BEFORE the transaction (it
  // makes one AI call, ~seconds). This is best-effort: generateQuestionPlan
  // always resolves — to the deterministic base plan if AI is unavailable — so
  // starting an interview never fails because of the model.
  //
  // If the founder uploaded a PRD before starting, it goes in as context so the
  // interview probes what the document leaves open rather than re-asking it.
  const documents = await getExtractedDocuments(project.id);
  const plan = await generateQuestionPlan(userId, project, documents);

  // Creating the session moves the project into DISCOVERY — one transaction,
  // so the session and the status flip can't disagree. The plan is stored on
  // the session and frozen from here, so progress/resume stay stable.
  const [session] = await prisma.$transaction(
    [
      prisma.discoverySession.create({
        data: { projectId, questionPlan: plan as unknown as Prisma.InputJsonValue },
      }),
      prisma.project.update({ where: { id: project.id }, data: { status: 'DISCOVERY' } }),
    ],
    { maxWait: 10000, timeout: 15000 },
  );

  return { session, ...buildProgress(plan, new Set()) };
}

export async function getSession(userId: string, projectId: string) {
  const project = await getProject(userId, projectId);

  const session = await prisma.discoverySession.findUnique({
    where: { projectId },
    include: { answers: { orderBy: { answeredAt: 'asc' } } },
  });
  if (!session) {
    throw ApiError.notFound('No discovery session for this project yet');
  }

  const plan = resolvePlan(session, project);
  const answeredIds = new Set(session.answers.map((a) => a.questionId));
  return { session, ...buildProgress(plan, answeredIds) };
}

export async function submitAnswer(userId: string, projectId: string, input: SubmitAnswerInput) {
  const project = await getProject(userId, projectId);

  const session = await prisma.discoverySession.findUnique({ where: { projectId } });
  if (!session) {
    throw ApiError.notFound('No discovery session for this project yet');
  }
  if (session.status !== 'ACTIVE') {
    throw ApiError.badRequest(`This session is ${session.status.toLowerCase()} — answers are closed`);
  }

  // The question must belong to THIS session's plan, not the global library.
  const plan = resolvePlan(session, project);
  const question = plan.find((q) => q.id === input.questionId);
  if (!question) {
    throw ApiError.badRequest(`Unknown questionId for this session: ${input.questionId}`);
  }

  // Preserve any AI follow-up already attached to this answer; a revised
  // main answer or a followUpAnswer submission updates the JSONB in place.
  const existing = await prisma.discoveryAnswer.findUnique({
    where: { sessionId_questionId: { sessionId: session.id, questionId: question.id } },
  });
  const existingPayload = (existing?.answer ?? {}) as Partial<AnswerPayload>;

  // Grade confidence only when the main answer text actually changes — a
  // follow-up reply resubmits the same text and shouldn't trigger a re-grade.
  const textChanged = existingPayload.text !== input.answer;
  let confidence = existingPayload.confidence ?? null;
  let confidenceLabel = existingPayload.confidenceLabel ?? null;
  if (textChanged) {
    const graded = await gradeAnswerConfidence(userId, projectId, question, input.answer);
    confidence = graded?.confidence ?? null;
    confidenceLabel = graded?.confidenceLabel ?? null;
  }

  const payload: AnswerPayload = {
    text: input.answer,
    confidence,
    confidenceLabel,
    // Submitting a question IS the review step for a document-drafted answer:
    // the founder has now seen it and either kept or rewrote it. We keep the
    // provenance (so the UI can still show "from your PRD") but clear the flag.
    ...(existingPayload.source
      ? {
          source: existingPayload.source,
          sourceDocumentId: existingPayload.sourceDocumentId,
          needsReview: false,
        }
      : {}),
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
  // Surface the just-graded confidence on the submit response (also stored in
  // the JSONB, so GET /discovery returns it on every answer too).
  return { ...buildProgress(plan, new Set(answers.map((a) => a.questionId))), confidence, confidenceLabel };
}

// Pre-fill the interview from the project's uploaded PRD/MVP documents.
//
// This does NOT skip discovery — it drafts answers into the same session the
// founder then walks through, reviews, and edits. Drafted answers are marked
// `needsReview` and completing the interview is blocked until each has been
// submitted by the founder, so a document can never silently become a blueprint.
//
// Re-runnable: a second document (or a re-run after a failed one) fills in
// questions still unanswered and refreshes earlier drafts, but NEVER overwrites
// an answer the founder wrote or reviewed themselves.
export async function prefillFromDocuments(userId: string, projectId: string) {
  const project = await getProject(userId, projectId);

  const session = await prisma.discoverySession.findUnique({
    where: { projectId },
    include: { answers: true },
  });
  if (!session) {
    throw ApiError.notFound('No discovery session for this project yet');
  }
  if (session.status !== 'ACTIVE') {
    throw ApiError.badRequest(
      `This session is ${session.status.toLowerCase()} — answers are closed`,
    );
  }

  const documents = await getExtractedDocuments(projectId);
  if (documents.length === 0) {
    throw ApiError.badRequest(
      'No readable document on this project yet. Upload one and wait for its status to become EXTRACTED.',
    );
  }

  const plan = resolvePlan(session, project);

  // Questions the founder has personally answered are off-limits — their own
  // words always win over anything we draft from a document.
  const ownedByFounder = new Set(
    session.answers
      .filter((a) => {
        const payload = a.answer as unknown as AnswerPayload;
        return payload.source !== 'document' || payload.needsReview === false;
      })
      .map((a) => a.questionId),
  );

  const drafted = await generatePrefill(userId, project, plan, documents);
  const applicable = drafted.filter((d) => !ownedByFounder.has(d.questionId));

  // Attribute the draft to the newest document — with several uploaded we
  // can't tell which one a given answer came from, and the newest is the one
  // the founder just added.
  const sourceDocumentId = documents[0]!.id;

  for (const draft of applicable) {
    const question = plan.find((q) => q.id === draft.questionId)!;
    const payload: AnswerPayload = {
      text: draft.answer,
      confidence: draft.confidence,
      confidenceLabel: draft.confidence === null ? null : confidenceBand(draft.confidence),
      source: 'document',
      sourceDocumentId,
      needsReview: true,
    };

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
  }

  const answers = await prisma.discoveryAnswer.findMany({
    where: { sessionId: session.id },
    select: { questionId: true },
  });

  return {
    ...buildProgress(plan, new Set(answers.map((a) => a.questionId))),
    // What the founder needs to know: how many answers are waiting on them,
    // and how many questions the document simply didn't cover.
    filled: applicable.length,
    skipped: plan.length - answers.length,
    documentsUsed: documents.map((d) => ({ id: d.id, fileName: d.fileName })),
  };
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

  const plan = resolvePlan(session, project);
  const question = plan.find((q) => q.id === questionId);
  if (!question) {
    throw ApiError.badRequest(`Unknown questionId for this session: ${questionId}`);
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
      answer: {
        text: payload.text,
        confidence: payload.confidence ?? null,
        confidenceLabel: payload.confidenceLabel ?? null,
        ...provenanceOf(payload),
        followUp: { question: followUpQuestion, answer: null },
      },
    },
  });

  return { questionId, followUp: followUpQuestion };
}

// Dismiss the AI follow-up on a question (the founder doesn't want to answer it
// and wants to move on). Removes the stored follow-up so the UI stops prompting;
// re-generating later creates a fresh one. Follow-ups are optional and never
// block completion, so this is purely clearing UI state.
export async function skipFollowUp(userId: string, projectId: string, questionId: string) {
  await getProject(userId, projectId);

  const session = await prisma.discoverySession.findUnique({ where: { projectId } });
  if (!session) {
    throw ApiError.notFound('No discovery session for this project yet');
  }

  const answerRow = await prisma.discoveryAnswer.findUnique({
    where: { sessionId_questionId: { sessionId: session.id, questionId } },
  });
  if (!answerRow) {
    throw ApiError.badRequest('No answer for this question yet');
  }

  const payload = answerRow.answer as unknown as AnswerPayload;
  if (!payload.followUp) {
    throw ApiError.badRequest('There is no follow-up to skip on this question');
  }

  // Rewrite the answer without the followUp key.
  await prisma.discoveryAnswer.update({
    where: { id: answerRow.id },
    data: {
      answer: {
        text: payload.text,
        confidence: payload.confidence ?? null,
        confidenceLabel: payload.confidenceLabel ?? null,
        ...provenanceOf(payload),
      },
    },
  });

  return { questionId, followUpSkipped: true };
}

// Pause the interview to continue later. Answers are closed while PAUSED
// (submitAnswer already rejects any non-ACTIVE session); resume flips it back.
export async function pauseSession(userId: string, projectId: string) {
  await getProject(userId, projectId);

  const session = await prisma.discoverySession.findUnique({ where: { projectId } });
  if (!session) {
    throw ApiError.notFound('No discovery session for this project yet');
  }
  if (session.status !== 'ACTIVE') {
    throw ApiError.badRequest(`Only an active session can be paused (this one is ${session.status.toLowerCase()})`);
  }

  return prisma.discoverySession.update({
    where: { id: session.id },
    data: { status: 'PAUSED' },
  });
}

export async function resumeSession(userId: string, projectId: string) {
  await getProject(userId, projectId);

  const session = await prisma.discoverySession.findUnique({ where: { projectId } });
  if (!session) {
    throw ApiError.notFound('No discovery session for this project yet');
  }
  if (session.status !== 'PAUSED') {
    throw ApiError.badRequest(`Only a paused session can be resumed (this one is ${session.status.toLowerCase()})`);
  }

  return prisma.discoverySession.update({
    where: { id: session.id },
    data: { status: 'ACTIVE' },
  });
}

export async function completeSession(userId: string, projectId: string) {
  const project = await getProject(userId, projectId);

  const session = await prisma.discoverySession.findUnique({
    where: { projectId },
    include: { answers: true },
  });
  if (!session) {
    throw ApiError.notFound('No discovery session for this project yet');
  }
  if (session.status !== 'ACTIVE') {
    throw ApiError.badRequest('This session is already closed');
  }

  const plan = resolvePlan(session, project);
  const answeredIds = new Set(session.answers.map((a) => a.questionId));
  const unanswered = plan.filter((q) => !answeredIds.has(q.id));
  if (unanswered.length > 0) {
    throw ApiError.badRequest(
      `Cannot complete: ${unanswered.length} question(s) unanswered (next: "${unanswered[0]!.id}")`,
    );
  }

  // Answers we drafted from an uploaded document are not the founder's answers
  // until the founder has actually looked at them. Blocking here is the whole
  // point of pre-fill going through the interview instead of around it.
  const unreviewed = session.answers.filter(
    (a) => (a.answer as unknown as AnswerPayload).needsReview === true,
  );
  if (unreviewed.length > 0) {
    throw ApiError.badRequest(
      `Cannot complete: ${unreviewed.length} answer(s) drafted from your document still need your review ` +
        `(next: "${unreviewed[0]!.questionId}"). Open each one and submit it to confirm.`,
    );
  }

  const updated = await prisma.discoverySession.update({
    where: { id: session.id },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });

  // Proactive Strategist refresh now that discovery is complete (fire-and-forget).
  triggerRecommendations(userId, projectId, 'discovery.complete');

  return updated;
}
