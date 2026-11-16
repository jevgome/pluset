// Sidebar form for AI settings: provider, key or helper token, models and options.
// Saves on every change and re-renders when the provider changes.

import { checkHelper, DEFAULT_HELPER_URL } from '../ai/claudeCode';
import { loadSettings, PROVIDERS, providerMeta, saveSettings, type AiSettings, type ProviderId } from '../ai/settings';
import { h } from './dom';

export async function mountAiSettings(container: HTMLElement): Promise<void> {
  let s = await loadSettings();
  const status = h('p', { class: 'status', role: 'status' });
  const setStatus = (text: string, tone: 'ok' | 'error' | 'info' = 'ok') => {
    status.textContent = text;
    status.dataset.tone = tone;
  };
  const update = async (patch: Partial<AiSettings>, rerender = false) => {
    s = { ...s, ...patch };
    await saveSettings(s);
    if (rerender) render();
    setStatus('Saved.');
  };

  function render() {
    const meta = providerMeta(s.provider);

    const providerSelect = h('select', { id: 'ai-provider' }) as HTMLSelectElement;
    for (const p of PROVIDERS) providerSelect.append(h('option', { value: p.id }, p.label));
    providerSelect.value = s.provider;
    providerSelect.addEventListener('change', () => {
      const id = providerSelect.value as ProviderId;
      const models = providerMeta(id).models;
      const keep = (m: string) => (models.some((x) => x.id === m) ? m : models[0]!.id);
      void update({ provider: id, generatorModel: keep(s.generatorModel), reviewerModel: keep(s.reviewerModel) }, true);
    });

    const keyInput = h('input', { id: 'ai-key', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: meta.keyHint }) as HTMLInputElement;
    keyInput.value = s.apiKeys[s.provider] ?? '';
    keyInput.addEventListener('change', () => void update({ apiKeys: { ...s.apiKeys, [s.provider]: keyInput.value.trim() } }));

    const modelSelect = (id: string, value: string, field: 'generatorModel' | 'reviewerModel') => {
      const sel = h('select', { id }) as HTMLSelectElement;
      for (const m of meta.models) sel.append(h('option', { value: m.id }, m.label));
      sel.value = meta.models.some((m) => m.id === value) ? value : meta.models[0]!.id;
      sel.addEventListener('change', () => void update({ [field]: sel.value }));
      return sel;
    };

    const checkbox = (label: string, checked: boolean, onChange: (v: boolean) => void) => {
      const c = h('input', { type: 'checkbox' }) as HTMLInputElement;
      c.checked = checked;
      c.addEventListener('change', () => onChange(c.checked));
      return h('label', { class: 'check' }, c, h('span', {}, label));
    };

    const providerFields: HTMLElement[] = [];
    if (s.provider === 'claude-code') {
      const urlInput = h('input', { type: 'url', spellcheck: 'false', placeholder: DEFAULT_HELPER_URL }) as HTMLInputElement;
      urlInput.value = s.helperUrl;
      urlInput.addEventListener('change', () => void update({ helperUrl: urlInput.value.trim() || DEFAULT_HELPER_URL }));
      const test = h('button', { type: 'button', class: 'secondary' }, 'Test connection') as HTMLButtonElement;
      test.addEventListener('click', async () => {
        setStatus('Checking…', 'info');
        try {
          await checkHelper({ url: s.helperUrl || DEFAULT_HELPER_URL, token: (s.apiKeys['claude-code'] ?? '').trim() });
          setStatus('Connected to the helper.');
        } catch (e) {
          setStatus(e instanceof Error ? e.message : String(e), 'error');
        }
      });
      providerFields.push(h('label', { class: 'field' }, h('span', {}, 'Helper address'), urlInput), test);
    } else {
      providerFields.push(
        checkbox('Send figure images (better problems, costs more)', s.sendImages, (v) => void update({ sendImages: v })),
        checkbox('If Claude declines a request, retry on a fallback model', s.fallbacks, (v) => void update({ fallbacks: v })),
      );
    }

    container.replaceChildren(
      h('label', { class: 'field' }, h('span', {}, 'Provider'), providerSelect),
      h(
        'p',
        { class: 'hint' },
        meta.help,
        meta.helpUrl ? ' ' : '',
        meta.helpUrl ? h('a', { href: meta.helpUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Get an API key') : '',
      ),
      h('label', { class: 'field' }, h('span', {}, meta.keyLabel), keyInput),
      h('p', { class: 'hint' }, 'Stored only in this browser.'),
      ...providerFields,
      h('label', { class: 'field' }, h('span', {}, 'Model that writes problems'), modelSelect('ai-gen-model', s.generatorModel, 'generatorModel')),
      h('label', { class: 'field' }, h('span', {}, 'Model that reviews them'), modelSelect('ai-rev-model', s.reviewerModel, 'reviewerModel')),
      status,
    );
  }

  render();
}
