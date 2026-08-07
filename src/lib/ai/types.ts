// The provider contract. Everything Fritlow-specific talks to THIS interface,
// never to a vendor SDK directly — that's what makes providers swappable
// config instead of a refactor.

export interface AiCompletionRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
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
