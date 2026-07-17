import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env';
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from './types';

// The only file in the codebase allowed to import the Anthropic SDK.

let client: Anthropic | null = null;

function getClient(): Anthropic {
  // Lazy: don't construct (or crash) at boot when no key is configured.
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}

export const anthropicProvider: AiProvider = {
  name: 'anthropic',

  isConfigured() {
    return Boolean(env.ANTHROPIC_API_KEY);
  },

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    const response = await getClient().messages.create(buildParams(request));
    return toResult(response);
  },

  async completeStream(
    request: AiCompletionRequest,
    onDelta: (text: string) => void,
  ): Promise<AiCompletionResult> {
    // Streaming avoids HTTP timeouts on long generations AND lets the
    // client render progress live.
    const stream = getClient().messages.stream(buildParams(request));
    stream.on('text', onDelta);
    const response = await stream.finalMessage();
    return toResult(response);
  },
};

function buildParams(request: AiCompletionRequest) {
  return {
    model: env.AI_MODEL,
    max_tokens: request.maxTokens ?? 1024,
    // Adaptive thinking: the model decides how much reasoning a task needs.
    thinking: { type: 'adaptive' as const },
    ...(request.system ? { system: request.system } : {}),
    messages: [{ role: 'user' as const, content: request.prompt }],
  };
}

function toResult(response: Anthropic.Message): AiCompletionResult {
  // Content is a list of typed blocks (text, thinking, …) — keep the text.
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  return {
    text,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
