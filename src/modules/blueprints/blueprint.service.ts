import type { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';
import * as aiService from '../../lib/ai/ai.service';
import { ApiError } from '../../utils/api-error';
import { getProject } from '../projects/project.service';
import { triggerRecommendations } from '../recommendations/recommendation.service';
import { blueprintSectionDefs } from './blueprint.sections';
import type { UpdateSectionInput } from './blueprint.schemas';

// Pulls the model's JSON out even if it wrapped it in ```json fences or prose.
function parseJsonObject(raw: string): Record<string, string> {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw ApiError.badRequest('AI returned no JSON object');
  }
  const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw ApiError.badRequest('AI returned malformed JSON');
  }
  return parsed as Record<string, string>;
}

// Validates preconditions and builds the AI request. Shared by the sync
// and streaming generation paths so they can never drift apart.
async function prepareGeneration(userId: string, projectId: string) {
  const project = await getProject(userId, projectId);

  const existing = await prisma.blueprint.findUnique({ where: { projectId } });
  if (existing) {
    throw ApiError.conflict('This project already has a blueprint — edit its sections instead');
  }

  const session = await prisma.discoverySession.findUnique({
    where: { projectId },
    include: { answers: { orderBy: { answeredAt: 'asc' } } },
  });
  if (!session || session.status !== 'COMPLETED') {
    throw ApiError.badRequest('Complete the discovery interview before generating a blueprint');
  }

  // Everything the founder said, follow-ups included.
  const interviewTranscript = session.answers
    .map((a) => {
      const payload = a.answer as { text: string; followUp?: { question: string; answer: string | null } };
      const lines = [`Q (${a.module}): ${a.questionText}`, `A: ${payload.text}`];
      if (payload.followUp) {
        lines.push(`Follow-up Q: ${payload.followUp.question}`);
        if (payload.followUp.answer) lines.push(`Follow-up A: ${payload.followUp.answer}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');

  const sectionSpec = blueprintSectionDefs
    .map((s) => `- "${s.key}": ${s.title} — ${s.guidance}`)
    .join('\n');

  return {
    request: {
      feature: 'blueprint.generate',
      userId,
      projectId,
      maxTokens: 8192,
      system: GENERATION_SYSTEM_PROMPT,
      prompt: [
        `Project: ${project.name}`,
        `One-line idea: ${project.oneLineIdea}`,
        project.category ? `Category: ${project.category}` : '',
        '',
        'Sections to write (key: title — guidance):',
        sectionSpec,
        '',
        'Discovery interview transcript:',
        interviewTranscript,
      ].join('\n'),
    },
  };
}

const GENERATION_SYSTEM_PROMPT =
      'You are the blueprint writer inside Fritlow, a product operating system for founders. ' +
      'From a discovery interview transcript, write a build-ready product blueprint. ' +
      'Be concrete and honest: where the founder was vague, narrow it for them and say so; ' +
      'where evidence is missing, flag it as an open risk rather than inventing facts. ' +
      'Respond with ONLY a JSON object — no code fences, no commentary — whose keys are ' +
      'exactly the section keys given, and whose values are the section contents as markdown strings.';

// Parses the AI output, then writes blueprint + sections + project status
// flip atomically. Shared by both generation paths.
async function persistGenerated(projectId: string, raw: string) {
  let sectionsByKey: Record<string, string>;
  try {
    sectionsByKey = parseJsonObject(raw);
  } catch {
    throw new ApiError(502, 'AI returned an unparseable blueprint — please try again');
  }

  const missing = blueprintSectionDefs.filter((s) => !sectionsByKey[s.key]?.trim());
  if (missing.length > 0) {
    throw new ApiError(502, `AI blueprint was missing sections: ${missing.map((s) => s.key).join(', ')}`);
  }

  // Blueprint + all sections + project status flip, atomically.
  const blueprint = await prisma.$transaction(async (tx) => {
    const created = await tx.blueprint.create({
      data: { projectId, status: 'READY', generatedAt: new Date() },
    });
    await tx.blueprintSection.createMany({
      data: blueprintSectionDefs.map((def, index) => ({
        blueprintId: created.id,
        key: def.key,
        title: def.title,
        order: index,
        content: { markdown: sectionsByKey[def.key]!.trim() },
      })),
    });
    await tx.project.update({ where: { id: projectId }, data: { status: 'BLUEPRINT_COMPLETE' } });
    return created;
  });

  return getBlueprintById(blueprint.id);
}

// The heavy AI call: turn the completed discovery interview into the
// eight-section Living Blueprint.
export async function generateBlueprint(userId: string, projectId: string) {
  const { request } = await prepareGeneration(userId, projectId);
  const raw = await aiService.generateText(request);
  const blueprint = await persistGenerated(projectId, raw);
  // Proactive Strategist refresh now that the blueprint exists (fire-and-forget).
  triggerRecommendations(userId, projectId, 'blueprint.generated');
  return blueprint;
}

// Streaming twin for the SSE endpoint: same validation, same persistence,
// but the caller sees the model's text as it is written.
export async function generateBlueprintStream(
  userId: string,
  projectId: string,
  onDelta: (text: string) => void,
) {
  const { request } = await prepareGeneration(userId, projectId);
  const raw = await aiService.generateTextStream(request, onDelta);
  const blueprint = await persistGenerated(projectId, raw);
  // Proactive Strategist refresh now that the blueprint exists (fire-and-forget).
  triggerRecommendations(userId, projectId, 'blueprint.generated');
  return blueprint;
}

async function getBlueprintById(id: string) {
  return prisma.blueprint.findUnique({
    where: { id },
    include: { sections: { orderBy: { order: 'asc' } } },
  });
}

export async function getBlueprint(userId: string, projectId: string) {
  await getProject(userId, projectId);

  const blueprint = await prisma.blueprint.findUnique({
    where: { projectId },
    include: { sections: { orderBy: { order: 'asc' } } },
  });
  if (!blueprint) {
    throw ApiError.notFound('No blueprint for this project yet — generate one first');
  }
  return blueprint;
}

// Resolves the section for a project + key, running the membership gate and
// the not-found checks that every section operation shares.
async function getOwnedSection(userId: string, projectId: string, sectionKey: string) {
  await getProject(userId, projectId);

  const blueprint = await prisma.blueprint.findUnique({ where: { projectId } });
  if (!blueprint) {
    throw ApiError.notFound('No blueprint for this project yet');
  }

  const section = await prisma.blueprintSection.findUnique({
    where: { blueprintId_key: { blueprintId: blueprint.id, key: sectionKey } },
  });
  if (!section) {
    throw ApiError.notFound(`Unknown blueprint section: ${sectionKey}`);
  }
  return section;
}

// The "Living" in Living Blueprint: sections stay editable after generation.
// Every edit first snapshots the outgoing content into the version history,
// then overwrites — atomically, so a snapshot can't exist without its edit.
export async function updateSection(
  userId: string,
  projectId: string,
  sectionKey: string,
  input: UpdateSectionInput,
) {
  const section = await getOwnedSection(userId, projectId, sectionKey);

  return prisma.$transaction(async (tx) => {
    const priorVersions = await tx.blueprintSectionVersion.count({
      where: { blueprintSectionId: section.id },
    });
    await tx.blueprintSectionVersion.create({
      data: {
        blueprintSectionId: section.id,
        sectionKey: section.key,
        projectId,
        content: section.content as Prisma.InputJsonValue,
        versionNumber: priorVersions + 1,
        editedById: userId,
      },
    });
    return tx.blueprintSection.update({
      where: { id: section.id },
      data: { content: { markdown: input.markdown } },
    });
  });
}

// The history behind a section — newest edit first. Each row is the content
// as it was before some edit replaced it, plus who made that edit and when.
export async function listSectionVersions(userId: string, projectId: string, sectionKey: string) {
  const section = await getOwnedSection(userId, projectId, sectionKey);

  return prisma.blueprintSectionVersion.findMany({
    where: { blueprintSectionId: section.id },
    orderBy: { versionNumber: 'desc' },
    include: { editedBy: { select: { id: true, fullName: true } } },
  });
}

// Dynamic Impact Analysis: after a section is edited, ask the AI which OTHER
// sections may now be inconsistent with it, and why. On-demand (a separate
// endpoint, not baked into PATCH) so saves stay fast — the cross-section AI
// call would blow the response-time budget on every keystroke-save.
export async function analyzeSectionImpact(userId: string, projectId: string, sectionKey: string) {
  const section = await getOwnedSection(userId, projectId, sectionKey);

  const sections = await prisma.blueprintSection.findMany({
    where: { blueprintId: section.blueprintId },
    orderBy: { order: 'asc' },
  });
  const others = sections.filter((s) => s.id !== section.id);
  if (others.length === 0) {
    return { affectedSections: [], generatedAt: new Date().toISOString() };
  }

  const edited = section.content as { markdown?: string };
  const othersText = others
    .map((s) => {
      const c = s.content as { markdown?: string };
      return `### ${s.key} — ${s.title}\n${c.markdown ?? ''}`;
    })
    .join('\n\n');

  const raw = await aiService.generateText({
    feature: 'blueprint.impact_analysis',
    userId,
    projectId,
    maxTokens: 2048,
    system:
      'You analyze consistency across a product blueprint. Given one section that was just ' +
      'edited and the other sections, identify which OTHER sections may now be inconsistent, ' +
      'outdated, or contradicted by the edit, and briefly why. Only list sections that are ' +
      'genuinely affected — an empty list is a fine answer. Respond with ONLY a JSON array, ' +
      'no code fences: [{"sectionKey":"<one of the provided keys>","reason":"<1 sentence>"}].',
    prompt: [
      `Edited section: "${section.key}" — ${section.title}`,
      `Its new content:\n${edited.markdown ?? ''}`,
      '',
      'Other sections (key — title, then content):',
      othersText,
    ].join('\n'),
  });

  let parsed: unknown;
  try {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new ApiError(502, 'AI returned an unparseable impact analysis — please try again');
  }

  // Keep only real other-section keys with a reason — never invent sections.
  const validKeys = new Set(sections.map((s) => s.key));
  const affectedSections = (Array.isArray(parsed) ? parsed : [])
    .map((x: { sectionKey?: unknown; reason?: unknown }) => ({
      sectionKey: String(x.sectionKey ?? '').trim(),
      reason: String(x.reason ?? '').trim(),
    }))
    .filter(
      (x) => x.sectionKey && x.reason && validKeys.has(x.sectionKey) && x.sectionKey !== section.key,
    );

  return { affectedSections, generatedAt: new Date().toISOString() };
}

// Roll a section back to a prior version. This is non-destructive: the current
// content is snapshotted as a new version first, so forward history survives.
export async function restoreSectionVersion(
  userId: string,
  projectId: string,
  sectionKey: string,
  versionId: string,
) {
  const section = await getOwnedSection(userId, projectId, sectionKey);

  const version = await prisma.blueprintSectionVersion.findUnique({ where: { id: versionId } });
  if (!version || version.blueprintSectionId !== section.id) {
    throw ApiError.notFound('Version not found for this section');
  }

  return prisma.$transaction(async (tx) => {
    const priorVersions = await tx.blueprintSectionVersion.count({
      where: { blueprintSectionId: section.id },
    });
    await tx.blueprintSectionVersion.create({
      data: {
        blueprintSectionId: section.id,
        sectionKey: section.key,
        projectId,
        content: section.content as Prisma.InputJsonValue,
        versionNumber: priorVersions + 1,
        editedById: userId,
      },
    });
    return tx.blueprintSection.update({
      where: { id: section.id },
      data: { content: version.content as Prisma.InputJsonValue },
    });
  });
}
