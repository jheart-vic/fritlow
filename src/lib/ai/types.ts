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

export interface AiCompletionRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
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
