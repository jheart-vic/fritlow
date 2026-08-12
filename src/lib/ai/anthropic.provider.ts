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
  model: env.AI_MODEL,

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

// Anthropic's vision/document input: images and PDFs are content blocks in the
// user message, placed BEFORE the text so the model reads the file first.
// A PDF goes in as a `document` block — the model sees both its text layer and
// a rendered image of each page, which is why scans need no OCR on our side.
const IMAGE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

function isImageMediaType(mimeType: string): mimeType is ImageMediaType {
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(mimeType);
}

function toContentBlocks(request: AiCompletionRequest): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];

  for (const attachment of request.attachments ?? []) {
    if (attachment.kind === 'pdf') {
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: attachment.base64 },
      });
      continue;
    }
    if (!isImageMediaType(attachment.mimeType)) {
      // Better to fail loudly than to answer about an image we never sent.
      throw new Error(`Anthropic does not accept image type: ${attachment.mimeType}`);
    }
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: attachment.mimeType, data: attachment.base64 },
    });
  }

  blocks.push({ type: 'text', text: request.prompt });
  return blocks;
}

function buildParams(request: AiCompletionRequest) {
  const hasAttachments = (request.attachments?.length ?? 0) > 0;

  return {
    model: env.AI_MODEL,
    max_tokens: request.maxTokens ?? 1024,
    // Adaptive thinking: the model decides how much reasoning a task needs.
    thinking: { type: 'adaptive' as const },
    ...(request.system ? { system: request.system } : {}),
    messages: [
      {
        role: 'user' as const,
        // Keep the plain-string form when there are no attachments — it's the
        // overwhelmingly common case and reads better in the audit log.
        content: hasAttachments ? toContentBlocks(request) : request.prompt,
      },
    ],
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
