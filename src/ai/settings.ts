// AI settings, stored locally in the extension (chrome.storage.local is not synced
// to other devices). API keys never leave the browser except in requests to the
// provider they belong to.

import { claudeProvider, CLAUDE_MODELS } from './anthropic';
import { claudeCodeProvider, CLAUDE_CODE_MODELS, DEFAULT_HELPER_URL } from './claudeCode';
import type { AiProvider, ModelInfo } from './provider';

export type ProviderId = 'anthropic' | 'claude-code';

export interface AiSettings {
  provider: ProviderId;
  /** API key per provider (for Claude Code: the helper token). */
  apiKeys: Partial<Record<ProviderId, string>>;
  /** Address of the local Pluset helper (Claude Code provider). */
  helperUrl: string;
  generatorModel: string;
  reviewerModel: string;
  /** Attach the book's figure images so the AI can see them (costs more tokens). */
  sendImages: boolean;
  /** Claude: if a request is declined, automatically retry on a fallback model. */
  fallbacks: boolean;
}

export const DEFAULT_SETTINGS: AiSettings = {
  provider: 'claude-code',
  apiKeys: {},
  helperUrl: DEFAULT_HELPER_URL,
  generatorModel: 'claude-opus-5-5',
  reviewerModel: 'claude-opus-5-5',
  sendImages: true,
  fallbacks: true,
};

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  models: ModelInfo[];
  keyLabel: string;
  keyHint: string;
  help: string;
  helpUrl: string | null;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: 'claude-code',
    label: 'Claude Code (your Claude plan)',
    models: CLAUDE_CODE_MODELS,
    keyLabel: 'Helper token',
    keyHint: 'printed by "npm run helper"',
    help: 'Uses your Claude subscription through Claude Code, no API key needed. Run "npm run helper" in the project folder and keep it open while generating.',
    helpUrl: null,
  },
  {
    id: 'anthropic',
    label: 'Claude API (API key)',
    models: CLAUDE_MODELS,
    keyLabel: 'API key',
    keyHint: 'sk-ant-…',
    help: 'Pay-as-you-go API access, billed separately from Claude subscriptions.',
    helpUrl: 'https://platform.claude.com/settings/keys',
  },
];

const KEY = 'ai:settings';

export async function loadSettings(): Promise<AiSettings> {
  const got = await chrome.storage.local.get(KEY);
  const saved = (got[KEY] ?? {}) as Partial<AiSettings>;
  // Settings saved before the Claude Code provider existed had an API key: keep using the API then.
  const provider = saved.provider ?? (saved.apiKeys?.anthropic ? 'anthropic' : DEFAULT_SETTINGS.provider);
  return { ...DEFAULT_SETTINGS, ...saved, provider, apiKeys: { ...(saved.apiKeys ?? {}) } };
}

export async function saveSettings(s: AiSettings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

export function providerMeta(id: ProviderId): ProviderMeta {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]!;
}

export function modelInfo(s: AiSettings, id: string): ModelInfo | undefined {
  return providerMeta(s.provider).models.find((m) => m.id === id);
}

/** Builds the configured provider, or explains what's missing. */
export function createProvider(s: AiSettings): AiProvider {
  const key = s.apiKeys[s.provider]?.trim();
  if (!key) throw new Error(`Add your ${providerMeta(s.provider).keyLabel.toLowerCase()} in AI settings first.`);
  switch (s.provider) {
    case 'anthropic':
      return claudeProvider({ apiKey: key, fallbacks: s.fallbacks });
    case 'claude-code':
      return claudeCodeProvider({ url: s.helperUrl || DEFAULT_HELPER_URL, token: key });
  }
}
