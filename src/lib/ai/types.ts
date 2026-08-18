// The provider contract. Everything Fritlow-specific talks to THIS interface,
// never to a vendor SDK directly — that's what makes providers swappable
// config instead of a refactor.

// A file sent to the model alongside the prompt — an image the founder
// uploaded, or a PDF with no text layer (a scan). Deliberately vendor-neutral:
// each provider translates this into its own wire format, so callers never
// learn which vendor is configured.
//
// `kind` matters because the two providers represent images and documents
// differently; `base64` is the raw file, no data: URI prefix.
export interface AiAttachment {
  kind: 'image' | 'pdf';
  mimeType: string;
  base64: string;
}

// How hard the model should think before answering. Vendor-neutral on purpose:
// OpenAI maps it to `reasoning.effort`, Anthropic to its thinking budget.
//
// This is a real lever, not a tuning knob to ignore. On a reasoning model the
// thinking is billed against the SAME budget as the visible answer, so a task
// that needs little reasoning and a short answer should say so — otherwise it
// pays for deliberation it never needed, in both latency and tokens.
export type AiReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface AiCompletionRequest {
  system?: string;
  prompt: string;
  // Total output budget. On reasoning models this covers the model's INTERNAL
  // reasoning as well as the text you get back, so it must leave room for both
  // — a budget sized only to the expected answer produces an empty response.
  maxTokens?: number;
  // Per-call override of the configured default. Structured extraction should
  // use 'low'; open-ended strategy work can afford 'medium' or 'high'.
  reasoningEffort?: AiReasoningEffort;
  // Optional. Providers that receive attachments they can't represent should
  // throw rather than silently dropping them — a silently text-only answer
  // about an image is worse than an error.
  attachments?: AiAttachment[];
}

export interface AiCompletionResult {
  text: string;
  model: string; // the exact model that answered
  inputTokens: number;
  outputTokens: number;
}

export interface AiProvider {
  readonly name: string;
  // The exact model this provider is configured to call. Used for the audit
  // log's error path (on success we log the model the API actually reports).
  readonly model: string;
  isConfigured(): boolean;
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>;
  // Streaming variant: onDelta fires per text chunk; resolves with the
  // same final result as complete().
  completeStream(
    request: AiCompletionRequest,
    onDelta: (text: string) => void,
  ): Promise<AiCompletionResult>;
}
