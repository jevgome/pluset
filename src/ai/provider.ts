// Provider-neutral interface for "send book material + instructions, get JSON
// matching a schema back". Each AI provider implements this in its own file;
// nothing else in the app depends on a specific provider.

export type ContentPart =
  | { type: 'text'; text: string; /** Large, reused prefix (book material): cache it if the provider can. */ cacheable?: boolean }
  | { type: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string /* base64 */ }
  /** A PDF the model reads directly (pages as text and images). Providers that can't read PDFs skip it. */
  | { type: 'document'; mediaType: 'application/pdf'; data: string /* base64 */; title?: string };

export interface JsonRequest {
  model: string;
  system: string;
  content: ContentPart[];
  schema: Record<string, unknown>;
  maxTokens: number;
  effort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface JsonResponse {
  data: unknown;
  usage: Usage;
  /** Model that actually answered (may differ if the provider fell back to another model). */
  model: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  /** USD per million tokens, or null when usage isn't billed per token (e.g. a subscription). */
  price: { input: number; output: number; cacheRead: number; cacheWrite: number } | null;
  vision: boolean;
}

export interface AiProvider {
  id: string;
  label: string;
  models: ModelInfo[];
  requestJson(req: JsonRequest): Promise<JsonResponse>;
}

export type AiErrorKind = 'auth' | 'rate_limit' | 'overloaded' | 'refusal' | 'truncated' | 'bad_output' | 'network' | 'cancelled' | 'other';

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** Estimated cost in USD of `usage` on `model`. */
export function costOf(usage: Usage, model: ModelInfo | undefined): number | null {
  const p = model?.price;
  if (!p) return null;
  return (
    (usage.inputTokens * p.input + usage.outputTokens * p.output + usage.cacheReadTokens * p.cacheRead + usage.cacheWriteTokens * p.cacheWrite) /
    1_000_000
  );
}
