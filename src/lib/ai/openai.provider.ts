import OpenAI from 'openai';
import type { Response } from 'openai/resources/responses/responses';
import { env } from '../../config/env';
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from './types';

// The only file in the codebase allowed to import the OpenAI SDK.
// Mirrors anthropic.provider.ts one-for-one so the two are interchangeable
// behind the AiProvider contract — the whole point of the provider layer.
//
// We use OpenAI's Responses API (not chat.completions): it maps cleanly onto
// our contract — `instructions` = system, `input` = prompt, and its usage
// object already reports input_tokens / output_tokens like Anthropic's does.

let client: OpenAI | null = null;

function getClient(): OpenAI {
  // Lazy: don't construct (or crash) at boot when no key is configured.
  if (!client) {
    client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return client;
}

export const openaiProvider: AiProvider = {
  name: 'openai',
  model: env.OPENAI_MODEL,

  isConfigured() {
    return Boolean(env.OPENAI_API_KEY);
  },

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    const response = await getClient().responses.create(buildParams(request));
    return toResult(response);
  },

  async completeStream(
    request: AiCompletionRequest,
    onDelta: (text: string) => void,
  ): Promise<AiCompletionResult> {
    // Same reasons as Anthropic: dodge HTTP timeouts on long generations and
    // let the client render progress live.
    const stream = getClient().responses.stream(buildParams(request));
    stream.on('response.output_text.delta', (event) => onDelta(event.delta));
    const response = await stream.finalResponse();
    return toResult(response);
  },
};

// Attachments on the Responses API: `input` becomes a list of typed content
// parts instead of a bare string. Images go in as `input_image` with a data
// URL; PDFs as `input_file` (the model reads both the text and the page images,
// so a scan needs no OCR from us). Files come first so the model reads them
// before the instruction — same ordering rule as the Anthropic path.
function toContentParts(request: AiCompletionRequest) {
  const parts = (request.attachments ?? []).map((attachment) => {
    const dataUrl = `data:${attachment.mimeType};base64,${attachment.base64}`;
    return attachment.kind === 'pdf'
      ? { type: 'input_file' as const, filename: 'document.pdf', file_data: dataUrl }
      : { type: 'input_image' as const, image_url: dataUrl, detail: 'auto' as const };
  });

  return [...parts, { type: 'input_text' as const, text: request.prompt }];
}

// Return type is inferred (not annotated): the object omits `stream`, which
// lets create() resolve to the non-streaming overload and stream() accept it.
function buildParams(request: AiCompletionRequest) {
  const hasAttachments = (request.attachments?.length ?? 0) > 0;

  return {
    model: env.OPENAI_MODEL,
    // GPT-5 is a reasoning model: its INTERNAL reasoning is billed as output
    // and shares this budget with the visible answer. Size this to
    // reasoning + answer, never to the answer alone — if reasoning exhausts
    // the budget the API returns status "incomplete" with NO text at all
    // (see assertComplete below, which turns that into a real error).
    max_output_tokens: request.maxTokens ?? 4096,
    // Per-call effort beats the global default: structured extraction wants
    // 'low' (faster, cheaper, and far less likely to spend the whole budget
    // thinking), open-ended analysis can afford more.
    reasoning: { effort: request.reasoningEffort ?? env.OPENAI_REASONING_EFFORT },
    ...(request.system ? { instructions: request.system } : {}),
    // Keep the plain-string form when there are no attachments (the common case).
    input: hasAttachments
      ? [{ role: 'user' as const, content: toContentParts(request) }]
      : request.prompt,
  };
}

// A reasoning model that runs out of budget mid-thought returns HTTP 200 with
// status "incomplete" and an EMPTY output_text — it never got to the answer.
//
// Left undetected this is genuinely misleading: the call looks successful, the
// audit log records SUCCESS, and the failure surfaces much later as whatever
// the caller does with an empty string (for impact analysis, "the AI returned
// unparseable JSON" — pointing at a parser that was never the problem).
//
// Fail here instead, naming the actual cause and the fix.
function assertComplete(response: Response): void {
  const text = (response.output_text ?? '').trim();
  if (text.length > 0) return;

  const reason = response.incomplete_details?.reason;
  if (response.status === 'incomplete' && reason === 'max_output_tokens') {
    throw new Error(
      `The model used its entire ${response.usage?.output_tokens ?? '?'}-token budget on ` +
        'reasoning and returned no answer. Raise maxTokens for this call, or lower its ' +
        'reasoningEffort.',
    );
  }
  if (response.status === 'incomplete') {
    throw new Error(`The model returned no output (incomplete: ${reason ?? 'unknown reason'}).`);
  }
  // Empty without an "incomplete" flag — a refusal or a genuinely empty answer.
  throw new Error('The model returned an empty response.');
}

function toResult(response: Response): AiCompletionResult {
  assertComplete(response);
  return {
    // The SDK aggregates all output_text blocks into this convenience getter.
    text: (response.output_text ?? '').trim(),
    model: response.model,
    // Non-streaming and streaming both populate usage on the final response;
    // guard with 0 in case a future model omits it.
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}
