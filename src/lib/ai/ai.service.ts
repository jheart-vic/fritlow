import { env } from '../../config/env';
import { prisma } from '../prisma';
import { ApiError } from '../../utils/api-error';
import { anthropicProvider } from './anthropic.provider';
import type { AiProvider } from './types';

// The single entry point for AI in Fritlow. Feature services call
// generateText(); this module picks the provider and logs every call
// (success AND failure) to AiInteraction — the PRD's end-to-end audit trail.

const providers: Record<string, AiProvider> = {
  anthropic: anthropicProvider,
};

function getProvider(): AiProvider {
  const provider = providers[env.AI_PROVIDER];
  if (!provider) {
    throw new ApiError(503, `Unknown AI provider: ${env.AI_PROVIDER}`);
  }
  return provider;
}

export interface GenerateTextParams {
  feature: string; // e.g. "discovery.follow_up" — for the audit log
  system?: string;
  prompt: string;
  maxTokens?: number;
  userId?: string;
  projectId?: string;
}

export async function generateText(params: GenerateTextParams): Promise<string> {
  return run(params, (provider, request) => provider.complete(request));
}

// Streaming twin: onDelta receives text chunks as the model writes them.
// Same logging, same error handling — only delivery differs.
export async function generateTextStream(
  params: GenerateTextParams,
  onDelta: (text: string) => void,
): Promise<string> {
  return run(params, (provider, request) => provider.completeStream(request, onDelta));
}

type Executor = (
  provider: ReturnType<typeof getProvider>,
  request: { system?: string; prompt: string; maxTokens?: number },
) => ReturnType<ReturnType<typeof getProvider>['complete']>;

async function run(params: GenerateTextParams, execute: Executor): Promise<string> {
  const provider = getProvider();

  if (!provider.isConfigured()) {
    throw new ApiError(503, 'AI is not configured on this server (missing API key)');
  }

  const startedAt = Date.now();

  try {
    const result = await execute(provider, {
      system: params.system,
      prompt: params.prompt,
      maxTokens: params.maxTokens,
    });

    await prisma.aiInteraction.create({
      data: {
        feature: params.feature,
        provider: provider.name,
        model: result.model,
        systemPrompt: params.system,
        userPrompt: params.prompt,
        response: result.text,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: Date.now() - startedAt,
        status: 'SUCCESS',
        userId: params.userId,
        projectId: params.projectId,
      },
    });

    return result.text;
  } catch (err) {
    // Log the failure too, then surface a clean error to the caller.
    await prisma.aiInteraction
      .create({
        data: {
          feature: params.feature,
          provider: provider.name,
          model: env.AI_MODEL,
          systemPrompt: params.system,
          userPrompt: params.prompt,
          latencyMs: Date.now() - startedAt,
          status: 'ERROR',
          error: err instanceof Error ? err.message : String(err),
          userId: params.userId,
          projectId: params.projectId,
        },
      })
      .catch(() => {}); // logging must never mask the original error

    if (err instanceof ApiError) throw err;
    console.error('AI call failed:', err);
    throw new ApiError(502, 'The AI provider returned an error — please try again');
  }
}
