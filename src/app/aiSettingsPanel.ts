// Sidebar form for AI settings: provider, API key, models and options.
// Saves on every change.

import { loadSettings, PROVIDERS, saveSettings, type AiSettings } from '../ai/settings';
import { h } from './dom';

export async function mountAiSettings(container: HTMLElement): Promise<void> {
  let s = await loadSettings();
  const save = async () => {
    await saveSettings(s);
    status.textContent = 'Saved.';
    status.dataset.tone = 'ok';
  };
  const status = h('p', { class: 'status', role: 'status' });

  const provider = () => PROVIDERS.find((p) => p.id === s.provider) ?? PROVIDERS[0]!;

  const providerSelect = h('select', { id: 'ai-provider' }) as HTMLSelectElement;
  for (const p of PROVIDERS) providerSelect.append(h('option', { value: p.id }, p.label));
  providerSelect.value = s.provider;

  const keyInput = h('input', {
    id: 'ai-key',
    type: 'password',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: provider().keyHint,
  }) as HTMLInputElement;
  keyInput.value = s.apiKeys[s.provider] ?? '';

  const modelSelect = (id: string, value: string) => {
    const sel = h('select', { id }) as HTMLSelectElement;
    for (const m of provider().models) sel.append(h('option', { value: m.id }, m.label));
    sel.value = provider().models.some((m) => m.id === value) ? value : provider().models[0]!.id;
    return sel;
  };
  const genSelect = modelSelect('ai-gen-model', s.generatorModel);
  const revSelect = modelSelect('ai-rev-model', s.reviewerModel);

  const checkbox = (id: string, checked: boolean) => {
    const c = h('input', { id, type: 'checkbox' }) as HTMLInputElement;
    c.checked = checked;
    return c;
  };
  const imagesBox = checkbox('ai-images', s.sendImages);
  const fallbackBox = checkbox('ai-fallbacks', s.fallbacks);

  const keyLink = h('a', { href: provider().keyUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Get an API key');

  keyInput.addEventListener('change', () => {
    s = { ...s, apiKeys: { ...s.apiKeys, [s.provider]: keyInput.value.trim() } };
    void save();
  });
  providerSelect.addEventListener('change', () => {
    s = { ...s, provider: providerSelect.value as AiSettings['provider'] };
    void save();
  });
  genSelect.addEventListener('change', () => {
    s = { ...s, generatorModel: genSelect.value };
    void save();
  });
  revSelect.addEventListener('change', () => {
    s = { ...s, reviewerModel: revSelect.value };
    void save();
  });
  imagesBox.addEventListener('change', () => {
    s = { ...s, sendImages: imagesBox.checked };
    void save();
  });
  fallbackBox.addEventListener('change', () => {
    s = { ...s, fallbacks: fallbackBox.checked };
    void save();
  });

  container.replaceChildren(
    h('label', { class: 'field' }, h('span', {}, 'Provider'), providerSelect),
    h('label', { class: 'field' }, h('span', {}, 'API key'), keyInput),
    h('p', { class: 'hint' }, 'Stored only in this browser and sent only to the provider. ', keyLink, '.'),
    h('label', { class: 'field' }, h('span', {}, 'Model that writes problems'), genSelect),
    h('label', { class: 'field' }, h('span', {}, 'Model that reviews them'), revSelect),
    h('label', { class: 'check' }, imagesBox, h('span', {}, 'Send figure images (better problems, costs more)')),
    h('label', { class: 'check' }, fallbackBox, h('span', {}, 'If Claude declines a request, retry on a fallback model')),
    status,
  );
}
