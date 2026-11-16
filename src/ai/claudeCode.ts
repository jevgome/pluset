// "Claude Code (your Claude plan)" provider: sends requests to the local Pluset
// helper (helper/server.mjs), which runs headless Claude Code with the user's own
// login. No API key or API billing; usage counts toward the plan's limits.

import { AiError, type AiErrorKind, type AiProvider, type JsonRequest, type JsonResponse, type ModelInfo } from './provider';

export const DEFAULT_HELPER_URL = 'http://localhost:48230';

export const CLAUDE_CODE_MODELS: ModelInfo[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best quality)', price: null, vision: false },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (uses less of your limits)', price: null, vision: false },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (lightest)', price: null, vision: false },
];

export interface ClaudeCodeOptions {
  url: string;
  token: string;
}

const KINDS: Record<string, AiErrorKind> = { rate_limit: 'rate_limit', auth: 'auth', cancelled: 'cancelled', bad_output: 'bad_output' };

async function call(opts: ClaudeCodeOptions, path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${opts.url.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' },
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new AiError('cancelled', 'Cancelled.');
    throw new AiError('network', 'Couldn’t reach the Pluset helper. Start it with "npm run helper" in the project folder.');
  }
}

/** Checks that the helper is running and the token is right. */
export async function checkHelper(opts: ClaudeCodeOptions): Promise<void> {
  const res = await call(opts, '/health');
  if (res.status === 401) throw new AiError('auth', 'The helper is running, but the token doesn’t match. Copy it again from the helper’s window.');
  if (!res.ok) throw new AiError('other', `The helper answered with HTTP ${res.status}.`);
}

export function claudeCodeProvider(opts: ClaudeCodeOptions): AiProvider {
  return {
    id: 'claude-code',
    label: 'Claude Code (your Claude plan)',
    models: CLAUDE_CODE_MODELS,
    async requestJson(req: JsonRequest): Promise<JsonResponse> {
      // Claude Code receives one text prompt; images aren't passed (figure descriptions are in the text).
      const prompt = req.content.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n\n');
      const res = await call(opts, '/v1/json', {
        method: 'POST',
        body: JSON.stringify({ model: req.model, system: req.system, schema: req.schema, effort: req.effort, prompt }),
        signal: req.signal,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; kind?: string } & Partial<JsonResponse>;
      if (res.status === 401) throw new AiError('auth', 'The Pluset helper rejected the token. Copy it again from the helper’s window into AI settings.');
      if (!res.ok) throw new AiError(KINDS[body.kind ?? ''] ?? 'other', body.error ?? `The helper answered with HTTP ${res.status}.`);
      return { data: body.data, model: body.model || req.model, usage: body.usage! };
    },
  };
}
