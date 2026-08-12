import * as aiService from '../../lib/ai/ai.service';
import type { PlanQuestion } from './discovery.plan';

// Mapping an uploaded PRD onto THIS project's interview plan.
//
// The rule that shapes everything here: the model may only answer a question
// the document actually answers. A plausible-sounding invention is worse than
// a blank — the founder would review it, nod, and end up with a blueprint built
// on something they never said.

export interface PrefilledAnswer {
  questionId: string;
  answer: string;
  confidence: number | null;
}

// How much document text we hand the model. A long PRD plus a 15-question plan
// still fits comfortably; past this we truncate rather than risk a context
// error mid-upload. Roughly 30k tokens of document.
const MAX_DOCUMENT_CHARS = 120_000;

const SYSTEM_PROMPT =
  'You are reading a founder\'s existing product document (a PRD, spec, or pitch) and filling in ' +
  'their product-discovery interview from it, so they can review answers instead of retyping ' +
  'what they already wrote.\n' +
  'Rules:\n' +
  '- Answer ONLY the questions the document genuinely answers. Omit every other question ' +
  'entirely — do NOT guess, infer beyond the text, or write filler. A missing answer is correct ' +
  'and expected; an invented one is a serious error.\n' +
  '- Write each answer in the founder\'s own words wherever possible, as THEY would answer the ' +
  'question in first person. Do not add analysis or commentary.\n' +
  '- Keep each answer under 200 words.\n' +
  '- "confidence" is how directly the document answers that question: 90+ = stated explicitly, ' +
  '50-70 = implied but partial, below 40 = do not include the answer at all.\n' +
  'Return ONLY a JSON array. Each element: {"questionId": string, "answer": string, ' +
  '"confidence": number}. Return [] if the document answers nothing. No prose, no code fences.';

// Defensive parse — same posture as discovery.plan.ts: the model may wrap JSON
// in prose or fences, and may emit malformed or unknown items.
function parsePrefill(raw: string, validQuestionIds: Set<string>): PrefilledAnswer[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no JSON array in AI prefill response');
  }
  const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('AI prefill is not an array');

  const seen = new Set<string>();
  const answers: PrefilledAnswer[] = [];

  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const questionId = typeof rec.questionId === 'string' ? rec.questionId.trim() : '';
    const answer = typeof rec.answer === 'string' ? rec.answer.trim() : '';

    // Drop anything that isn't a real question in THIS session's plan, and any
    // duplicate — answers key off (sessionId, questionId).
    if (!questionId || !answer || !validQuestionIds.has(questionId) || seen.has(questionId)) {
      continue;
    }
    seen.add(questionId);

    const rawConfidence = typeof rec.confidence === 'number' ? rec.confidence : null;
    const confidence =
      rawConfidence === null ? null : Math.max(0, Math.min(100, Math.round(rawConfidence)));

    answers.push({ questionId, answer, confidence });
  }

  return answers;
}

// Ask the model which of these questions the documents answer.
// Throws on AI failure — unlike plan generation there is no deterministic
// fallback here (there is nothing sensible to invent), so the caller surfaces
// the error and the founder simply answers the interview themselves.
export async function generatePrefill(
  userId: string,
  project: { id: string; name: string; oneLineIdea: string; category: string | null },
  plan: PlanQuestion[],
  documents: { fileName: string; text: string }[],
): Promise<PrefilledAnswer[]> {
  const combined = documents
    .map((d) => `--- Document: ${d.fileName} ---\n${d.text}`)
    .join('\n\n')
    .slice(0, MAX_DOCUMENT_CHARS);

  const raw = await aiService.generateText({
    feature: 'discovery.prefill',
    userId,
    projectId: project.id,
    // Room for ~15 answers of a couple hundred words each, plus reasoning.
    maxTokens: 8192,
    system: SYSTEM_PROMPT,
    prompt: [
      `Project name: ${project.name}`,
      `One-line idea: ${project.oneLineIdea}`,
      project.category ? `Category: ${project.category}` : 'Category: (unspecified)',
      '',
      'Interview questions (JSON):',
      JSON.stringify(plan.map((q) => ({ questionId: q.id, module: q.module, text: q.text }))),
      '',
      "The founder's document(s):",
      combined,
    ].join('\n'),
  });

  return parsePrefill(raw, new Set(plan.map((q) => q.id)));
}
