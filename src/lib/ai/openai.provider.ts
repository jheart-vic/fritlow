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

// Return type is inferred (not annotated): the object omits `stream`, which
// lets create() resolve to the non-streaming overload and stream() accept it.
function buildParams(request: AiCompletionRequest) {
  return {
    model: env.OPENAI_MODEL,
    // GPT-5 is a reasoning model; reasoning tokens are billed as output and
    // share this budget, so the default is higher than Anthropic's 1024.
    max_output_tokens: request.maxTokens ?? 2048,
    reasoning: { effort: env.OPENAI_REASONING_EFFORT },
    ...(request.system ? { instructions: request.system } : {}),
    input: request.prompt,
  };
}

function toResult(response: Response): AiCompletionResult {
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
