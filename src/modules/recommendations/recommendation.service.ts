import { prisma } from '../../lib/prisma';
import * as aiService from '../../lib/ai/ai.service';
import { ApiError } from '../../utils/api-error';
import { getProject } from '../projects/project.service';
import type { ListRecommendationsQuery, UpdateRecommendationInput } from './recommendation.schemas';

// The AI Product Strategist. It reads everything the project knows so far
// (discovery answers, the blueprint if generated, the latest health score)
// and produces a handful of concrete, prioritized recommendations the founder
// can acknowledge / dismiss / resolve. Insights are stored rows — not chat.
// Shapes follow the frontend build spec.

type RecType = 'PRICING' | 'SCOPE' | 'AUDIENCE' | 'ONBOARDING' | 'GENERAL';
type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
const TYPES: RecType[] = ['PRICING', 'SCOPE', 'AUDIENCE', 'ONBOARDING', 'GENERAL'];
const SEVERITIES: Severity[] = ['INFO', 'WARNING', 'CRITICAL'];

// Same context floor as the health score: recommendations grade the founder's
// actual input, so there has to be enough of it to be worth grading.
const MIN_ANSWERS = 3;
const MAX_RECOMMENDATIONS = 6;

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
    parts.push('', 'Blueprint sections (key — title):');
    for (const s of blueprint.sections) {
      const content = s.content as { markdown?: string };
      parts.push(`## ${s.key} — ${s.title}\n${content.markdown ?? ''}`);
    }
  }

  if (healthScore?.summary) {
    parts.push('', `Current health score: ${healthScore.overall}/100 — ${healthScore.summary}`);
  }

  return { context: parts.join('\n'), answerCount: answers.length };
}

export async function generateRecommendations(userId: string, projectId: string) {
  await getProject(userId, projectId); // membership gate + 404
  return runGeneration(userId, projectId);
}

// The generation guts, minus the membership gate. Shared by the on-demand
// endpoint (which gates first) and the proactive triggers (system-invoked with
// a userId we already trust). Throws on insufficient context / AI failure.
async function runGeneration(userId: string, projectId: string) {
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
      'flatter. Each recommendation needs: a "type" (one of PRICING, SCOPE, AUDIENCE, ONBOARDING, GENERAL); ' +
      'a short "title"; a "body" in markdown (1-3 sentences: why it matters and what to do); a "severity" ' +
      '(INFO, WARNING, or CRITICAL); and a "sourceContext" naming what in the project triggered it ' +
      '(e.g. "blueprint.business_model", "health.differentiation", "discovery.customer"). ' +
      `Return between 3 and ${MAX_RECOMMENDATIONS} recommendations as ONLY a JSON array, no code fences: ` +
      '[{"type":"PRICING","title":"...","body":"...","severity":"WARNING","sourceContext":"..."}, ...]',
    prompt: context,
  });

  let parsed: Array<{
    type?: unknown;
    title?: unknown;
    body?: unknown;
    severity?: unknown;
    sourceContext?: unknown;
  }>;
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
      const body = String(r.body ?? '').trim();
      const t = String(r.type ?? 'GENERAL').trim().toUpperCase();
      const type: RecType = (TYPES as string[]).includes(t) ? (t as RecType) : 'GENERAL';
      const sev = String(r.severity ?? 'WARNING').trim().toUpperCase();
      const severity: Severity = (SEVERITIES as string[]).includes(sev) ? (sev as Severity) : 'WARNING';
      const sc = String(r.sourceContext ?? '').trim();
      return { type, title, body, severity, sourceContext: sc.length > 0 ? sc : null };
    })
    .filter((r) => r.title.length > 0 && r.body.length > 0);

  if (rows.length === 0) {
    throw new ApiError(502, 'AI recommendations were all malformed — please try again');
  }

  // Regenerating replaces the OPEN batch but KEEPS the founder's decisions
  // (ACKNOWLEDGED/DISMISSED/RESOLVED) as history — those are their calls.
  // maxWait is bumped from the 2s default: the long AI call above lets Neon's
  // pooled connection go idle, so acquiring one for the transaction can need a
  // cold-start moment ("Unable to start a transaction in the given time").
  await prisma.$transaction(
    [
      prisma.recommendation.deleteMany({ where: { projectId, status: 'OPEN' } }),
      prisma.recommendation.createMany({
        data: rows.map((r) => ({ ...r, projectId })),
      }),
    ],
    { maxWait: 15000, timeout: 15000 },
  );

  return listRecommendations(userId, projectId, {});
}

// Proactive, fire-and-forget refresh. Called after events that change what the
// Strategist would say (discovery completed, blueprint generated, a low health
// dimension). Deliberately NOT awaited by callers and never throws: a failure
// here must not slow or break the action that triggered it. Skips quietly when
// there isn't enough context yet (the runGeneration MIN_ANSWERS guard).
export function triggerRecommendations(userId: string, projectId: string, reason: string): void {
  void runGeneration(userId, projectId)
    .then(() => {
      console.log(`[recommendations] proactively refreshed for ${projectId} (${reason})`);
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[recommendations] proactive trigger (${reason}) skipped for ${projectId}: ${msg}`);
    });
}

export async function listRecommendations(
  userId: string,
  projectId: string,
  query: ListRecommendationsQuery,
) {
  await getProject(userId, projectId);

  // Newest first, per the build spec.
  return prisma.recommendation.findMany({
    where: { projectId, ...(query.status ? { status: query.status } : {}) },
    orderBy: { createdAt: 'desc' },
  });
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
