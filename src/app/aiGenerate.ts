// Runs AI generation for some sections and shows progress and results in a panel.

import { generateProblems, type GenerateResult } from '../ai/generate';
import { AiError } from '../ai/provider';
import { createProvider, loadSettings, modelInfo } from '../ai/settings';
import { addAiProblems, listAiProblems, type StoredAiProblem } from '../ai/store';
import { htmlToText } from '../ai/text';
import type { Section } from '../core/model';
import { sectionLabel } from '../core/model';
import { runAiCode } from './aiSource';
import { h, typeset } from './dom';
import { challengeSource } from './problemView';

const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/**
 * Generates `count` problems for `sections`, saving the ones that pass checks.
 * Renders into `panel`; resolves with the problems that were kept.
 */
export async function runGeneration(panel: HTMLElement, sections: Section[], count: number): Promise<StoredAiProblem[]> {
  const book = sections[0]?.book ?? '';
  const labels = sections.map(sectionLabel);
  const steps = h('ol', { class: 'zy-gen__steps' });
  const cancel = h('button', { type: 'button', class: 'secondary' }, 'Cancel') as HTMLButtonElement;
  const result = h('div', { class: 'zy-gen__result' });
  panel.replaceChildren(
    h('section', { class: 'zy-gen' }, h('h3', {}, `Generating ${count} AI problems for ${labels.join(', ')}`), steps, cancel, result),
  );
  const step = (text: string) => {
    for (const li of steps.querySelectorAll('li[data-active]')) li.removeAttribute('data-active');
    const li = h('li', { 'data-active': 'true' }, text);
    steps.append(li);
  };
  const fail = (message: string) => {
    for (const li of steps.querySelectorAll('li[data-active]')) li.removeAttribute('data-active');
    cancel.remove();
    result.replaceChildren(h('p', { class: 'status', 'data-tone': 'error' }, message));
    return [] as StoredAiProblem[];
  };

  const settings = await loadSettings();
  let provider;
  try {
    provider = createProvider(settings);
  } catch (e) {
    return fail(`${e instanceof Error ? e.message : String(e)} (AI settings are at the bottom of the sidebar.)`);
  }

  const controller = new AbortController();
  cancel.addEventListener('click', () => controller.abort());

  let res: GenerateResult;
  try {
    res = await generateProblems({
      book,
      sections,
      count,
      existing: await listAiProblems(book, labels),
      settings,
      provider,
      runCode: runAiCode,
      example: (block, level) => challengeSource(block, level)(() => {}).catch(() => null),
      onProgress: step,
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof AiError && e.kind === 'cancelled') return fail('Cancelled. Nothing was saved.');
    return fail(`Generation failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  await addAiProblems(book, res.kept);
  for (const li of steps.querySelectorAll('li[data-active]')) li.removeAttribute('data-active');
  cancel.remove();

  const u = res.usage;
  const tokens = `${fmtTokens(u.generator.inputTokens + u.generator.cacheReadTokens + u.generator.cacheWriteTokens + u.reviewer.inputTokens + u.reviewer.cacheReadTokens + u.reviewer.cacheWriteTokens)} in, ${fmtTokens(u.generator.outputTokens + u.reviewer.outputTokens)} out`;
  const cost = res.cost === null ? '' : ` · about $${res.cost.toFixed(2)}`;
  const rejected = res.rejected.length
    ? h(
        'details',
        { class: 'zy-gen__rejected' },
        h('summary', {}, `${res.rejected.length} rejected by the checks`),
        h(
          'ul',
          {},
          ...res.rejected.map((r) =>
            h('li', {}, h('span', { class: 'zy-gen__rejected-prompt' }, htmlToText(r.problem.prompt).slice(0, 140)), h('br'), h('span', { class: 'zy-muted' }, r.reasons.join('; '))),
          ),
        ),
      )
    : null;
  result.replaceChildren(
    h(
      'p',
      { class: 'status', 'data-tone': res.kept.length ? 'ok' : 'error' },
      res.kept.length
        ? `✓ Added ${res.kept.length} problem${res.kept.length === 1 ? '' : 's'}.`
        : 'No problems passed the checks this time. Try again, or try a different model.',
    ),
    h('p', { class: 'zy-muted' }, `${modelInfo(settings, settings.generatorModel)?.label ?? settings.generatorModel} · ${tokens}${cost}`),
  );
  if (rejected) result.append(rejected);
  typeset(result);
  return res.kept;
}
