import type { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';
import * as aiService from '../../lib/ai/ai.service';
import { ApiError } from '../../utils/api-error';
import { getProject } from '../projects/project.service';

// The Product Health Score: the AI grades the project across five fixed
// dimensions with honest feedback; the overall 0-100 is OUR average of the
// dimension scores (never trust a model to do arithmetic consistently).

const DIMENSIONS = [
  { key: 'problem_clarity', label: 'Problem Clarity' },
  { key: 'target_audience', label: 'Target Audience' },
  { key: 'business_model', label: 'Business Model' },
  { key: 'differentiation', label: 'Differentiation' },
  { key: 'mvp_focus', label: 'MVP Focus' },
] as const;

const MIN_ANSWERS = 3;

interface DimensionScore {
  key: string;
  label: string;
  score: number;
  feedback: string;
}

export async function computeHealthScore(userId: string, projectId: string) {
  const project = await getProject(userId, projectId);

  const session = await prisma.discoverySession.findUnique({
    where: { projectId },
    include: { answers: { orderBy: { answeredAt: 'asc' } } },
  });
  if (!session || session.answers.length < MIN_ANSWERS) {
    throw ApiError.badRequest(
      `Answer at least ${MIN_ANSWERS} discovery questions first — the score grades your answers`,
    );
  }

  const transcript = session.answers
    .map((a) => {
      const payload = a.answer as { text: string };
      return `Q (${a.module}): ${a.questionText}\nA: ${payload.text}`;
    })
    .join('\n\n');

  const raw = await aiService.generateText({
    feature: 'health.score',
    userId,
    projectId,
    maxTokens: 4096,
    system:
      'You are the Product Health Score grader inside Fritlow, a product operating system for founders. ' +
      'Grade the discovery answers honestly — this score exists to surface weaknesses BEFORE the founder ' +
      'spends money building. Vague answers ("everyone", "we\'ll figure out pricing later") must score low. ' +
      'For each dimension give a score from 0-100 and 1-2 sentences of direct, actionable feedback. ' +
      'Also write a 2-3 sentence overall summary naming the single biggest risk. ' +
      'Respond with ONLY a JSON object, no code fences: ' +
      '{"dimensions": {"<key>": {"score": <int>, "feedback": "<string>"}, ...}, "summary": "<string>"} ' +
      `using exactly these dimension keys: ${DIMENSIONS.map((d) => d.key).join(', ')}.`,
    prompt: [
      `Project: ${project.name}`,
      `One-line idea: ${project.oneLineIdea}`,
      project.category ? `Category: ${project.category}` : '',
      '',
      `Discovery answers (${session.answers.length} so far):`,
      transcript,
    ].join('\n'),
  });

  let parsed: {
    dimensions: Record<string, { score: number; feedback: string }>;
    summary: string;
  };
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new ApiError(502, 'AI returned an unparseable health score — please try again');
  }

  const dimensions: DimensionScore[] = DIMENSIONS.map((d) => {
    const entry = parsed.dimensions?.[d.key];
    if (!entry || typeof entry.score !== 'number') {
      throw new ApiError(502, `AI health score was missing dimension: ${d.key}`);
    }
    return {
      key: d.key,
      label: d.label,
      score: Math.max(0, Math.min(100, Math.round(entry.score))),
      feedback: String(entry.feedback ?? ''),
    };
  });

  const overall = Math.round(dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length);

  // Prisma's Json input type wants an explicit cast for arrays.
  const dimensionsJson = dimensions as unknown as Prisma.InputJsonValue;

  const healthScore = await prisma.healthScore.upsert({
    where: { projectId },
    create: { projectId, overall, dimensions: dimensionsJson, summary: parsed.summary ?? null },
    update: { overall, dimensions: dimensionsJson, summary: parsed.summary ?? null },
  });

  return healthScore;
}

export async function getHealthScore(userId: string, projectId: string) {
  await getProject(userId, projectId);

  const healthScore = await prisma.healthScore.findUnique({ where: { projectId } });
  if (!healthScore) {
    throw ApiError.notFound('No health score yet — compute one first');
  }
  return healthScore;
}
