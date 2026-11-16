// A practice session: one new version of every challenge level in the chosen
// sections, in book, shuffled or weakest-first order, then a summary.

import type { ChallengeBlock, Section } from '../core/model';
import { sectionLabel } from '../core/model';
import { itemKey, loadProgress, orderItems, recordOutcome, type SessionOrder } from '../core/progress';
import { h, typeset } from './dom';
import { createProblemView, type Outcome, type ProblemView } from './problemView';

export interface SessionItem {
  key: string;
  book: string;
  section: Section;
  block: ChallengeBlock;
  level: number;
}

export function sessionItems(sections: Section[]): SessionItem[] {
  return sections.flatMap((section) =>
    section.blocks.flatMap((block) =>
      block.kind === 'challenge'
        ? block.levels.map((_, level) => ({
            key: itemKey(section.chapter, section.section, block.id, level),
            book: section.book,
            section,
            block,
            level,
          }))
        : [],
    ),
  );
}

interface Done {
  item: SessionItem;
  outcome: Outcome;
}

export async function runSession(
  container: HTMLElement,
  sections: Section[],
  order: SessionOrder,
  onExit: () => void,
): Promise<void> {
  const all = sessionItems(sections);
  const books = [...new Set(all.map((i) => i.book))];
  const progress = Object.assign({}, ...(await Promise.all(books.map(loadProgress))));
  const queue = orderItems(all, progress, order);
  const labels = sections.map(sectionLabel).join(', ');

  if (queue.length === 0) {
    container.replaceChildren(
      h(
        'div',
        { class: 'empty' },
        h('h2', {}, 'Nothing to practice yet'),
        h('p', {}, `The selected sections (${labels}) have no challenge activities. AI-generated problems from the reading and participation activities are coming next.`),
        backButton(onExit),
      ),
    );
    return;
  }

  const done: Done[] = [];
  let index = 0;
  let view: ProblemView | null = null;

  const bar = h('div', { class: 'zy-session__bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(queue.length) });
  const barFill = h('div', { class: 'zy-session__bar-fill' });
  bar.append(barFill);
  const counter = h('span', { class: 'zy-session__counter' });
  const score = h('span', { class: 'zy-session__score' });
  const source = h('p', { class: 'zy-session__source' });
  const slot = h('div');
  const nextBtn = h('button', { type: 'button' }, 'Skip') as HTMLButtonElement;
  const endBtn = h('button', { type: 'button', class: 'secondary' }, 'End session') as HTMLButtonElement;

  container.replaceChildren(
    h(
      'article',
      { class: 'zy-session' },
      h('header', { class: 'zy-session__header' }, h('h2', {}, `Practice · ${labels}`), h('div', { class: 'zy-session__stats' }, counter, score)),
      bar,
      source,
      slot,
      h('div', { class: 'zy-practice__controls zy-session__nav' }, nextBtn, endBtn),
    ),
  );

  function updateHeader() {
    const firstTry = done.filter((d) => d.outcome.firstTryCorrect).length;
    const attempted = done.filter((d) => d.outcome.attempted).length;
    counter.textContent = `Problem ${Math.min(index + 1, queue.length)} of ${queue.length}`;
    score.textContent = attempted ? `${firstTry} of ${attempted} right on the first try` : '';
    bar.setAttribute('aria-valuenow', String(done.length));
    barFill.style.width = `${(done.length / queue.length) * 100}%`;
  }

  function finishCurrent() {
    const item = queue[index];
    if (!view || !item) return;
    const outcome = view.outcome();
    done.push({ item, outcome });
    void recordOutcome(item.book, item.key, outcome);
    view = null;
  }

  function show() {
    const item = queue[index];
    if (!item) {
      summary();
      return;
    }
    const { section, block, level } = item;
    source.replaceChildren(
      h('span', { class: 'zy-session__section' }, `${sectionLabel(section)} ${section.title}`),
      ' · ',
      h('span', {}, block.caption),
      block.levels.length > 1 ? ` · Level ${level + 1} of ${block.levels.length}` : '',
    );
    typeset(source);
    nextBtn.textContent = 'Skip';
    nextBtn.classList.add('secondary');
    view = createProblemView(block, level, {
      onChange: (o) => {
        if (!o.attempted) return;
        nextBtn.textContent = index + 1 < queue.length ? 'Next problem →' : 'Finish';
        nextBtn.classList.remove('secondary');
      },
    });
    slot.replaceChildren(view.el);
    updateHeader();
  }

  function summary() {
    const attempted = done.filter((d) => d.outcome.attempted);
    const firstTry = attempted.filter((d) => d.outcome.firstTryCorrect).length;
    const solved = attempted.filter((d) => d.outcome.solved).length;
    const viewed = attempted.filter((d) => d.outcome.viewedSolution).length;

    const bySection = new Map<string, { label: string; attempted: number; firstTry: number }>();
    for (const d of attempted) {
      const label = `${sectionLabel(d.item.section)} ${d.item.section.title}`;
      const row = bySection.get(label) ?? { label, attempted: 0, firstTry: 0 };
      row.attempted++;
      if (d.outcome.firstTryCorrect) row.firstTry++;
      bySection.set(label, row);
    }

    const again = h('button', { type: 'button' }, 'Practice weakest again') as HTMLButtonElement;
    again.addEventListener('click', () => void runSession(container, sections, 'weakest', onExit));

    const table = bySection.size
      ? h(
          'table',
          { class: 'zy-session__table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Section'), h('th', {}, 'Right on first try'))),
          h(
            'tbody',
            {},
            ...[...bySection.values()].map((r) =>
              h('tr', {}, h('td', {}, r.label), h('td', {}, `${r.firstTry} of ${r.attempted}`)),
            ),
          ),
        )
      : null;

    container.replaceChildren(
      h(
        'article',
        { class: 'zy-session zy-session--summary' },
        h('h2', {}, 'Session complete'),
        attempted.length
          ? h(
              'div',
              { class: 'zy-session__totals' },
              stat(`${firstTry}/${attempted.length}`, 'right on the first try'),
              stat(`${solved}/${attempted.length}`, 'solved eventually'),
              stat(String(viewed), viewed === 1 ? 'solution viewed' : 'solutions viewed'),
            )
          : h('p', { class: 'hint' }, 'No problems were attempted.'),
        table,
        h('div', { class: 'zy-practice__controls' }, again, backButton(onExit)),
      ),
    );
  }

  nextBtn.addEventListener('click', () => {
    finishCurrent();
    index++;
    show();
  });
  endBtn.addEventListener('click', () => {
    finishCurrent();
    index = queue.length;
    summary();
  });

  show();
}

function stat(value: string, label: string) {
  return h('div', { class: 'zy-stat' }, h('span', { class: 'zy-stat__value' }, value), h('span', { class: 'zy-stat__label' }, label));
}

function backButton(onExit: () => void) {
  const b = h('button', { type: 'button', class: 'secondary' }, 'Back to library') as HTMLButtonElement;
  b.addEventListener('click', onExit);
  return b;
}
