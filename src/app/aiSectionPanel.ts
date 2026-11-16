// The "AI practice problems" area at the end of a section in the viewer:
// saved AI problems for the section (practice or delete each) and a generate button.

import { figureFor } from '../ai/generate';
import { deleteAiProblem, listAiProblems, type StoredAiProblem } from '../ai/store';
import { htmlToText } from '../ai/text';
import type { Section } from '../core/model';
import { sectionLabel } from '../core/model';
import { recordOutcome } from '../core/progress';
import { runGeneration } from './aiGenerate';
import { aiSource } from './aiSource';
import { h } from './dom';
import { createProblemView, type ProblemView } from './problemView';
import { aiItemKey } from './session';

const KIND = { multiple_choice: 'Multiple choice', short_answer: 'Short answer', numeric: 'Numeric' } as const;

function problemCard(p: StoredAiProblem, section: Section, onDelete: () => void): HTMLElement {
  const preview = htmlToText(p.problem.prompt).replace(/\$\{\s*\w+\s*\}/g, '▢').replace(/\s+/g, ' ');
  const practice = h('button', { type: 'button', class: 'secondary' }, 'Practice') as HTMLButtonElement;
  const del = h('button', { type: 'button', class: 'library__delete', title: 'Delete this problem', 'aria-label': 'Delete this problem' }, '×');
  const body = h('div');
  let view: ProblemView | null = null;

  const save = () => {
    if (view) void recordOutcome(p.book, aiItemKey(p), view.outcome());
  };
  practice.addEventListener('click', () => {
    save();
    view = createProblemView(aiSource(p, figureFor(p.problem, [section])));
    body.replaceChildren(view.el);
    practice.textContent = p.problem.kind === 'numeric' ? 'New version' : 'Restart';
  });
  del.addEventListener('click', async () => {
    await deleteAiProblem(p.book, p.section, p.id);
    onDelete();
  });

  return h(
    'li',
    { class: 'zy-ai-item' },
    h(
      'div',
      { class: 'zy-ai-item__head' },
      h('span', { class: 'zy-ai-badge' }, KIND[p.problem.kind]),
      h('span', { class: 'zy-ai-item__preview' }, preview.length > 160 ? `${preview.slice(0, 160)}…` : preview),
      practice,
      del,
    ),
    h('p', { class: 'zy-muted zy-ai-item__basis' }, `Based on ${p.problem.based_on}`),
    body,
  );
}

export function aiSectionPanel(section: Section): HTMLElement {
  const label = sectionLabel(section);
  const list = h('ul', { class: 'zy-ai-list' });
  const count = h(
    'select',
    { 'aria-label': 'Number of problems' },
    ...[3, 5, 8].map((n) => h('option', { value: String(n), ...(n === 5 ? { selected: '' } : {}) }, `${n} problems`)),
  ) as HTMLSelectElement;
  const generate = h('button', { type: 'button' }, 'Generate with AI') as HTMLButtonElement;
  const genPanel = h('div');
  const summary = h('p', { class: 'zy-muted' });

  async function refresh() {
    const problems = await listAiProblems(section.book, [label]);
    summary.textContent = problems.length
      ? `${problems.length} saved AI problem${problems.length === 1 ? '' : 's'} for ${label}. They're also included in practice sessions.`
      : `No AI problems for ${label} yet. Generated problems are checked against the book before they're saved.`;
    list.replaceChildren(...problems.map((p) => problemCard(p, section, () => void refresh())));
  }

  generate.addEventListener('click', async () => {
    generate.disabled = true;
    try {
      await runGeneration(genPanel, [section], Number(count.value));
      await refresh();
    } finally {
      generate.disabled = false;
    }
  });

  void refresh();
  return h(
    'section',
    { class: 'zy-card zy-card--ai' },
    h('header', { class: 'zy-card__header' }, h('span', { class: 'zy-card__kind' }, 'AI practice problems'), h('span', { class: 'zy-card__caption' }, `Section ${label}`)),
    summary,
    list,
    h('div', { class: 'zy-practice__controls' }, count, generate),
    genPanel,
  );
}
