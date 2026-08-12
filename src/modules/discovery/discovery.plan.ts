import * as aiService from '../../lib/ai/ai.service';
import { assembleBasePlan, type DiscoveryQuestion } from './questions';

// A single question in a session's tailored plan. Same shape as a library
// question — the plan is just an ordered list of these, stored on the session.
export type PlanQuestion = DiscoveryQuestion;

// Bounds on a generated plan. Below MIN we distrust the model and fall back to
// the deterministic base plan; above MAX we trim (a 30-question interview is a
// bug, not a feature).
const MIN_PLAN = 6;
const MAX_PLAN = 20;

// Turn whatever the model returned into a clean PlanQuestion[] — or throw, so
// the caller falls back to the deterministic base plan. Defensive on purpose:
// the model can wrap JSON in prose or code fences, or emit malformed items.
function parsePlan(raw: string): PlanQuestion[] {
  // Pull out the JSON array even if it's fenced or surrounded by prose.
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no JSON array in AI plan response');
  }
  const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('AI plan is not an array');

  const seen = new Set<string>();
  const plan: PlanQuestion[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id.trim() : '';
    const moduleName = typeof rec.module === 'string' ? rec.module.trim() : '';
    const text = typeof rec.text === 'string' ? rec.text.trim() : '';
    if (!id || !moduleName || !text) continue; // skip incomplete items

    // Guarantee unique ids — answers key off them (sessionId + questionId).
    let uniqueId = id;
    let n = 2;
    while (seen.has(uniqueId)) uniqueId = `${id}.${n++}`;
    seen.add(uniqueId);

    const hint = typeof rec.hint === 'string' && rec.hint.trim() ? rec.hint.trim() : undefined;
    plan.push({ id: uniqueId, module: moduleName, text, ...(hint ? { hint } : {}) });
  }

  if (plan.length < MIN_PLAN) throw new Error(`AI plan too short (${plan.length})`);
  return plan.slice(0, MAX_PLAN);
}

// Generate a tailored interview plan for one project.
//
// Strategy (the "hybrid"): build the deterministic base plan first (core + the
// matched category pack), hand it to the AI as a starting point, and let the
// model reword questions to this project and add a couple of project-specific
// ones — but ALWAYS fall back to the base plan if the AI is unconfigured,
// errors, or returns junk. So the interview is per-project when AI is available
// and still complete/deterministic when it isn't.
//
// When the founder has already uploaded a PRD, an excerpt goes in too, so the
// interview asks about what their document DOESN'T cover instead of parroting
// questions it already answers.
export async function generateQuestionPlan(
  userId: string,
  project: { id: string; name: string; oneLineIdea: string; category: string | null },
  documents: { fileName: string; text: string }[] = [],
): Promise<PlanQuestion[]> {
  const basePlan = assembleBasePlan(project.category);

  // Only an excerpt: the plan needs orientation, not the whole document (the
  // pre-fill step is what reads it properly).
  const documentExcerpt = documents
    .map((d) => `--- ${d.fileName} ---\n${d.text}`)
    .join('\n\n')
    .slice(0, 20_000);

  try {
    const raw = await aiService.generateText({
      feature: 'discovery.plan',
      userId,
      projectId: project.id,
      maxTokens: 4096, // room for ~15 questions of JSON + reasoning headroom
      system:
        'You are a product-discovery interviewer for Fritlow, a product operating system that turns ' +
        'founder ideas into build-ready plans. You are given a founder\'s project and a BASE set of ' +
        'interview questions. Produce a TAILORED interview plan for THIS specific project.\n' +
        'Rules:\n' +
        '- Keep every core module represented at least once: problem, customer, business_model, ' +
        'differentiation, mvp_focus, go_to_market, risks.\n' +
        '- You MAY reword a question\'s text to reference this project\'s specifics, drop a redundant ' +
        'question, and add up to 2 new project-specific questions.\n' +
        '- Keep 8 to 15 questions total. Order them logically (problem → customer → business_model → ' +
        'differentiation → go_to_market → risks → mvp_focus).\n' +
        '- Reuse the given "id" whenever a question maps to a base question; for a NEW question use an ' +
        'id like "custom.1". Set "module" to one of the core module names above.\n' +
        'Return ONLY a JSON array. Each element: {"id": string, "module": string, "text": string, ' +
        '"hint": string}. No prose, no markdown, no code fences.',
      prompt: [
        `Project name: ${project.name}`,
        `One-line idea: ${project.oneLineIdea}`,
        project.category ? `Category: ${project.category}` : 'Category: (unspecified)',
        '',
        'Base questions (JSON):',
        JSON.stringify(
          basePlan.map((q) => ({ id: q.id, module: q.module, text: q.text, hint: q.hint ?? '' })),
        ),
        ...(documentExcerpt
          ? [
              '',
              "The founder has already written this document. Keep every core module covered, but " +
                'word the questions to push PAST what the document already settles — ask for the ' +
                "detail it leaves vague rather than repeating what it states:",
              documentExcerpt,
            ]
          : []),
      ].join('\n'),
    });

    const plan = parsePlan(raw);
    console.log(`[discovery] AI-tailored plan for project ${project.id}: ${plan.length} questions`);
    return plan;
  } catch (err) {
    // Unconfigured AI, provider error, or unparseable output — use the base plan.
    console.warn(
      `[discovery] plan generation fell back to base plan for project ${project.id}:`,
      err instanceof Error ? err.message : err,
    );
    return basePlan;
  }
}
