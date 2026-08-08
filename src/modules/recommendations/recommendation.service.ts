import { prisma } from '../../lib/prisma';
import * as aiService from '../../lib/ai/ai.service';
import { ApiError } from '../../utils/api-error';
import { getProject } from '../projects/project.service';
import type { ListRecommendationsQuery, UpdateRecommendationInput } from './recommendation.schemas';

// The AI Product Strategist. It reads everything the project knows so far
// (discovery answers, the blueprint if generated, the latest health score)
// and produces a handful of concrete, prioritized recommendations the founder
// can accept or reject. Insights are stored as rows — durable, not chat.

type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
const SEVERITIES: Severity[] = ['HIGH', 'MEDIUM', 'LOW'];
const SEVERITY_RANK: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

// Same context floor as the health score: recommendations grade the founder's
// actual input, so there has to be enough of it to be worth grading.
const MIN_ANSWERS = 3;
const MAX_RECOMMENDATIONS = 6;

// List ordered for triage: HIGH first, then newest within a severity.
function sortForTriage<T extends { severity: Severity; createdAt: Date }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

// Assemble everything we know about the project into one prompt context.
async function buildContext(projectId: string): Promise<{ context: string; answerCount: number }> {
  const [project, session, blueprint, healthScore] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId } }),
    prisma.discoverySession.findUnique({
      where: { projectId },
      include: { answers: { orderBy: { answeredAt: 'asc' } } },
    }),
    prisma.blueprint.findUnique({
      where: { projectId },
      include: { sections: { orderBy: { order: 'asc' } } },
    }),
    prisma.healthScore.findUnique({ where: { projectId } }),
  ]);

  const answers = session?.answers ?? [];

  const parts: string[] = [
    `Project: ${project?.name ?? ''}`,
    `One-line idea: ${project?.oneLineIdea ?? ''}`,
    project?.category ? `Category: ${project.category}` : '',
    '',
    `Discovery answers (${answers.length}):`,
    answers
      .map((a) => {
        const payload = a.answer as { text: string };
        return `Q (${a.module}): ${a.questionText}\nA: ${payload.text}`;
      })
      .join('\n\n'),
  ];

  if (blueprint && blueprint.sections.length > 0) {
    parts.push('', 'Blueprint sections:');
    for (const s of blueprint.sections) {
      const content = s.content as { markdown?: string };
      parts.push(`## ${s.title}\n${content.markdown ?? ''}`);
    }
  }

  if (healthScore?.summary) {
    parts.push('', `Current health score: ${healthScore.overall}/100 — ${healthScore.summary}`);
  }

  return { context: parts.join('\n'), answerCount: answers.length };
}

export async function generateRecommendations(userId: string, projectId: string) {
  await getProject(userId, projectId); // membership gate + 404

  const { context, answerCount } = await buildContext(projectId);
  if (answerCount < MIN_ANSWERS) {
    throw ApiError.badRequest(
      `Answer at least ${MIN_ANSWERS} discovery questions first — recommendations are based on your answers`,
    );
  }

  const raw = await aiService.generateText({
    feature: 'recommendations.generate',
    userId,
    projectId,
    maxTokens: 4096,
    system:
      'You are the AI Product Strategist inside Fritlow, a product operating system for founders. ' +
      'Read the project context and produce concrete, prioritized recommendations that help the founder ' +
      'make better decisions BEFORE building. Be specific and honest — challenge weak assumptions, do not ' +
      'flatter. Each recommendation needs: a short imperative "title" (e.g. "Narrow your first customer"), ' +
      'a "detail" of 1-3 sentences explaining why it matters and what to do, an "area" (one word: problem, ' +
      'customer, business_model, differentiation, mvp_focus, pricing, or general), and a "severity" of ' +
      'HIGH, MEDIUM, or LOW. ' +
      `Return between 3 and ${MAX_RECOMMENDATIONS} recommendations as ONLY a JSON array, no code fences: ` +
      '[{"title": "...", "detail": "...", "area": "...", "severity": "HIGH"}, ...]',
    prompt: context,
  });

  let parsed: Array<{ title?: unknown; detail?: unknown; area?: unknown; severity?: unknown }>;
  try {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new ApiError(502, 'AI returned unparseable recommendations — please try again');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new ApiError(502, 'AI returned no recommendations — please try again');
  }

  // Normalize + validate each row; skip anything malformed rather than fail
  // the whole batch on one bad entry.
  const rows = parsed
    .slice(0, MAX_RECOMMENDATIONS)
    .map((r) => {
      const title = String(r.title ?? '').trim();
      const detail = String(r.detail ?? '').trim();
      const area = String(r.area ?? 'general').trim().toLowerCase();
      const sev = String(r.severity ?? 'MEDIUM').trim().toUpperCase();
      const severity: Severity = (SEVERITIES as string[]).includes(sev) ? (sev as Severity) : 'MEDIUM';
      return { title, detail, area, severity };
    })
    .filter((r) => r.title.length > 0 && r.detail.length > 0);

  if (rows.length === 0) {
    throw new ApiError(502, 'AI recommendations were all malformed — please try again');
  }

  // Regenerating replaces the PENDING batch but KEEPS the founder's decisions
  // (ACCEPTED/REJECTED) as history — those are their answers, not the AI's.
  await prisma.$transaction([
    prisma.recommendation.deleteMany({ where: { projectId, status: 'PENDING' } }),
    prisma.recommendation.createMany({
      data: rows.map((r) => ({ ...r, projectId })),
    }),
  ]);

  return listRecommendations(userId, projectId, {});
}

export async function listRecommendations(
  userId: string,
  projectId: string,
  query: ListRecommendationsQuery,
) {
  await getProject(userId, projectId);

  const rows = await prisma.recommendation.findMany({
    where: { projectId, ...(query.status ? { status: query.status } : {}) },
  });
  return sortForTriage(rows as Array<(typeof rows)[number] & { severity: Severity }>);
}

export async function updateRecommendationStatus(
  userId: string,
  projectId: string,
  recommendationId: string,
  input: UpdateRecommendationInput,
) {
  await getProject(userId, projectId);

  const recommendation = await prisma.recommendation.findUnique({
    where: { id: recommendationId },
  });
  if (!recommendation || recommendation.projectId !== projectId) {
    throw ApiError.notFound('Recommendation not found in this project');
  }

  return prisma.recommendation.update({
    where: { id: recommendation.id },
    data: { status: input.status },
  });
}
