// Claude adapter, using the official Anthropic SDK directly from the extension
// page (the user's own key; requests go straight to api.anthropic.com).

import Anthropic from '@anthropic-ai/sdk';
import { AiError, type AiProvider, type JsonRequest, type JsonResponse, type ModelInfo } from './provider';

export const CLAUDE_MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5 (best quality)',
    price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    vision: true,
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5 (faster, cheaper)',
    price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
    vision: true,
  },
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5 (cheapest)',
    price: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    vision: true,
  },
];

/** Models that accept server-side refusal fallbacks (`fallbacks: "default"`). */
const SUPPORTS_FALLBACKS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

export interface ClaudeOptions {
  apiKey: string;
  /** Re-run on a fallback model if the request is declined by a safety classifier. */
  fallbacks: boolean;
}

function toContent(req: JsonRequest): Anthropic.Beta.BetaContentBlockParam[] {
  return req.content.map((part): Anthropic.Beta.BetaContentBlockParam =>
    part.type === 'text'
      ? { type: 'text', text: part.text, ...(part.cacheable ? { cache_control: { type: 'ephemeral' } } : {}) }
      : { type: 'image', source: { type: 'base64', media_type: part.mediaType, data: part.data } },
  );
}

function translateError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new AiError('cancelled', 'Cancelled.');
  if (e instanceof Anthropic.AuthenticationError) return new AiError('auth', 'Claude rejected the API key. Check it in AI settings.');
  if (e instanceof Anthropic.PermissionDeniedError) return new AiError('auth', `This API key can't use that model: ${e.message}`);
  if (e instanceof Anthropic.RateLimitError) return new AiError('rate_limit', 'Rate limited by Claude. Wait a minute and try again.');
  if (e instanceof Anthropic.APIConnectionError) return new AiError('network', `Couldn't reach Claude: ${e.message}`);
  if (e instanceof Anthropic.APIError) {
    if (e.status === 529) return new AiError('overloaded', 'Claude is overloaded right now. Try again shortly.');
    return new AiError('other', `Claude API error ${e.status ?? ''}: ${e.message}`);
  }
  return new AiError('other', e instanceof Error ? e.message : String(e));
}

export function claudeProvider(opts: ClaudeOptions): AiProvider {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    // The key is the user's own and stays in their browser; requests go only to api.anthropic.com.
    dangerouslyAllowBrowser: true,
  });

  return {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    models: CLAUDE_MODELS,
    async requestJson(req: JsonRequest): Promise<JsonResponse> {
      const useFallbacks = opts.fallbacks && SUPPORTS_FALLBACKS.has(req.model);
      let message: Anthropic.Beta.BetaMessage;
      try {
        const stream = client.beta.messages.stream(
          {
            model: req.model,
            max_tokens: req.maxTokens,
            system: req.system,
            messages: [{ role: 'user', content: toContent(req) }],
            output_config: {
              ...(req.effort ? { effort: req.effort } : {}),
              format: { type: 'json_schema', schema: req.schema },
            },
            ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
          },
          { signal: req.signal },
        );
        message = await stream.finalMessage();
      } catch (e) {
        throw translateError(e);
      }

      if (message.stop_reason === 'refusal') {
        const why = message.stop_details?.explanation;
        throw new AiError('refusal', `Claude declined this request${why ? `: ${why}` : '.'}`);
      }
      if (message.stop_reason === 'max_tokens') {
        throw new AiError('truncated', 'The response was cut off before it finished. Try generating fewer problems at once.');
      }
      const text = message.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new AiError('bad_output', 'Claude returned output that isn’t valid JSON.');
      }
      const u = message.usage;
      return {
        data,
        model: message.model,
        usage: {
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
          cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        },
      };
    },
  };
}
