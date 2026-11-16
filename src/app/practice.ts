// "Practice a new version" panel shown under each challenge activity in the
// section viewer: level tabs plus a generated problem.

import type { ChallengeBlock } from '../core/model';
import { recordOutcome } from '../core/progress';
import { h } from './dom';
import { createProblemView, type ProblemView } from './problemView';

export interface PracticeContext {
  book: string;
  /** Progress key prefix for this block, e.g. "8.5:130936836". */
  itemPrefix: string;
}

export function practicePanel(block: ChallengeBlock, ctx: PracticeContext): HTMLElement {
  const root = h('div', { class: 'zy-practice' });
  const start = h('button', { type: 'button', class: 'zy-practice__start' }, 'Practice a new version');
  root.append(start);

  let levelIndex = 0;
  let view: ProblemView | null = null;

  const tabs = h('div', { class: 'zy-practice__levels', role: 'group', 'aria-label': 'Level' });
  const slot = h('div');
  const newBtn = h('button', { type: 'button', class: 'secondary' }, 'New version') as HTMLButtonElement;
  const nextBtn = h('button', { type: 'button', class: 'secondary' }, 'Next level →') as HTMLButtonElement;
  const body = h('div', { class: 'zy-practice__body' }, tabs, slot, h('div', { class: 'zy-practice__controls' }, newBtn, nextBtn));

  function renderTabs() {
    tabs.replaceChildren();
    if (block.levels.length < 2) return;
    block.levels.forEach((level, i) => {
      const b = h('button', { type: 'button', class: 'zy-practice__level' }, level.name);
      if (i === levelIndex) b.setAttribute('aria-pressed', 'true');
      b.addEventListener('click', () => show(i));
      tabs.append(b);
    });
  }

  function saveCurrent() {
    if (view) void recordOutcome(ctx.book, `${ctx.itemPrefix}:${levelIndex}`, view.outcome());
  }

  function show(index: number) {
    saveCurrent();
    levelIndex = index;
    renderTabs();
    nextBtn.hidden = true;
    view = createProblemView(block, index, {
      onChange: (o) => {
        nextBtn.hidden = !(o.solved && levelIndex + 1 < block.levels.length);
      },
    });
    slot.replaceChildren(view.el);
  }

  newBtn.addEventListener('click', () => show(levelIndex));
  nextBtn.addEventListener('click', () => show(levelIndex + 1));
  start.addEventListener('click', () => {
    start.replaceWith(body);
    show(0);
  });
  nextBtn.hidden = true;
  return root;
}
