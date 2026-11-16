// AI settings, stored locally in the extension (chrome.storage.local is not synced
// to other devices). API keys never leave the browser except in requests to the
// provider they belong to.

import { claudeProvider, CLAUDE_MODELS } from './anthropic';
import type { AiProvider, ModelInfo } from './provider';

export interface AiSettings {
  provider: 'anthropic';
  apiKeys: Partial<Record<AiSettings['provider'], string>>;
  generatorModel: string;
  reviewerModel: string;
  /** Attach the book's figure images so the AI can see them (costs more tokens). */
  sendImages: boolean;
  /** Claude: if a request is declined, automatically retry on a fallback model. */
  fallbacks: boolean;
}

export const DEFAULT_SETTINGS: AiSettings = {
  provider: 'anthropic',
  apiKeys: {},
  generatorModel: 'claude-opus-5-5',
  reviewerModel: 'claude-opus-5-5',
  sendImages: true,
  fallbacks: true,
};

export const PROVIDERS: { id: AiSettings['provider']; label: string; models: ModelInfo[]; keyHint: string; keyUrl: string }[] = [
  {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    models: CLAUDE_MODELS,
    keyHint: 'sk-ant-…',
    keyUrl: 'https://platform.claude.com/settings/keys',
  },
];

const KEY = 'ai:settings';

export async function loadSettings(): Promise<AiSettings> {
  const got = await chrome.storage.local.get(KEY);
  const saved = (got[KEY] ?? {}) as Partial<AiSettings>;
  return { ...DEFAULT_SETTINGS, ...saved, apiKeys: { ...(saved.apiKeys ?? {}) } };
}

export async function saveSettings(s: AiSettings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

export function modelInfo(s: AiSettings, id: string): ModelInfo | undefined {
  return PROVIDERS.find((p) => p.id === s.provider)?.models.find((m) => m.id === id);
}

/** Builds the configured provider, or explains what's missing. */
export function createProvider(s: AiSettings): AiProvider {
  const key = s.apiKeys[s.provider]?.trim();
  if (!key) throw new Error('Add your API key in AI settings first.');
  switch (s.provider) {
    case 'anthropic':
      return claudeProvider({ apiKey: key, fallbacks: s.fallbacks });
  }
}
