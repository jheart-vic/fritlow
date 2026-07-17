import { prisma } from '../../lib/prisma';
import * as aiService from '../../lib/ai/ai.service';
import { ApiError } from '../../utils/api-error';
import { getProject } from '../projects/project.service';
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
  return persistGenerated(projectId, raw);
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
  return persistGenerated(projectId, raw);
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

// The "Living" in Living Blueprint: sections stay editable after generation.
export async function updateSection(
  userId: string,
  projectId: string,
  sectionKey: string,
  input: UpdateSectionInput,
) {
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

  return prisma.blueprintSection.update({
    where: { id: section.id },
    data: { content: { markdown: input.markdown } },
  });
}
