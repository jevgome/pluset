// "Practice a new version" panel for a challenge activity: runs the book's own
// generator code with a fresh random seed, checks answers with the book's
// tolerances, and reveals the worked solution only after an attempt.

import type { ChallengeBlock } from '../core/model';
import { checkAnswer } from '../engine/check';
import { randomSeed, runLevel } from '../engine/client';
import { instantiateLevel, type ProblemInstance, type ProblemPart } from '../engine/instantiate';
import { challengeTextEl, h, inRows, typeset } from './dom';

interface Slot {
  part: Extract<ProblemPart, { kind: 'input' | 'dropdown' }>;
  control: HTMLInputElement | HTMLSelectElement;
  mark: HTMLElement;
}

export function practicePanel(block: ChallengeBlock): HTMLElement {
  const root = h('div', { class: 'zy-practice' });
  const start = h('button', { type: 'button', class: 'zy-practice__start' }, 'Practice a new version');
  root.append(start);

  let levelIndex = 0;
  let attempted = false;
  let slots: Slot[] = [];
  let instance: ProblemInstance | null = null;

  const tabs = h('div', { class: 'zy-practice__levels', role: 'group', 'aria-label': 'Level' });
  const problem = h('div', { class: 'zy-practice__problem', 'aria-live': 'polite' });
  const status = h('p', { class: 'zy-practice__status', role: 'status' });
  const checkBtn = h('button', { type: 'button' }, 'Check') as HTMLButtonElement;
  const newBtn = h('button', { type: 'button', class: 'secondary' }, 'New version') as HTMLButtonElement;
  const solutionBtn = h('button', { type: 'button', class: 'secondary' }, 'Show solution') as HTMLButtonElement;
  const nextBtn = h('button', { type: 'button', class: 'secondary' }, 'Next level →') as HTMLButtonElement;
  const solution = h('div', { class: 'zy-practice__solution' });
  const controls = h('div', { class: 'zy-practice__controls' }, checkBtn, solutionBtn, newBtn, nextBtn);
  const body = h('div', { class: 'zy-practice__body' }, tabs, problem, controls, status, solution);

  const setStatus = (text: string, tone: 'ok' | 'error' | 'info' = 'info') => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  function renderTabs() {
    tabs.replaceChildren();
    if (block.levels.length < 2) return;
    block.levels.forEach((level, i) => {
      const b = h('button', { type: 'button', class: 'zy-practice__level' }, level.name);
      if (i === levelIndex) b.setAttribute('aria-pressed', 'true');
      b.addEventListener('click', () => void generate(i));
      tabs.append(b);
    });
  }

  function renderPart(part: ProblemPart): HTMLElement | null {
    switch (part.kind) {
      case 'text':
        return challengeTextEl(part.html);
      case 'input': {
        const input = h('input', {
          type: 'text',
          inputmode: 'decimal',
          autocomplete: 'off',
          spellcheck: 'false',
          'aria-label': part.label,
          ...(part.placeholder ? { placeholder: part.placeholder } : {}),
        }) as HTMLInputElement;
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') check();
        });
        const mark = h('span', { class: 'zy-mark', 'aria-hidden': 'true' });
        slots.push({ part, control: input, mark });
        return h('div', { class: 'zy-practice__slot' }, input, mark);
      }
      case 'dropdown': {
        const select = h('select', { 'aria-label': part.label }, h('option', { value: '' }, 'Pick')) as HTMLSelectElement;
        for (const o of part.options) select.append(h('option', { value: o }, o));
        const mark = h('span', { class: 'zy-mark', 'aria-hidden': 'true' });
        slots.push({ part, control: select, mark });
        return h('div', { class: 'zy-practice__slot' }, select, mark);
      }
      case 'image':
        return h(
          'figure',
          { class: 'zy-ch-figure' },
          h('div', { class: 'zy-img-missing' }, 'Figure (challenge images aren’t downloaded yet)'),
          part.image.alt ? h('figcaption', {}, part.image.alt) : null,
        );
      case 'unsupported':
        return h('p', { class: 'zy-muted' }, `[${part.type} element not supported yet]`);
    }
  }

  async function generate(index: number) {
    levelIndex = index;
    attempted = false;
    slots = [];
    instance = null;
    renderTabs();
    problem.replaceChildren();
    solution.replaceChildren();
    for (const b of [checkBtn, newBtn, solutionBtn, nextBtn]) b.disabled = true;
    nextBtn.hidden = true;
    setStatus('Generating… (the first one takes a few seconds while Python loads)');

    const level = block.levels[index];
    if (!level) return;
    try {
      const vars = await runLevel(block.sharedCode, level.code, randomSeed());
      instance = instantiateLevel(block, index, vars);
    } catch (e) {
      setStatus(`Couldn't generate this level: ${e instanceof Error ? e.message : String(e)}`, 'error');
      newBtn.disabled = false;
      return;
    }

    problem.append(...inRows(instance.parts, renderPart));
    typeset(problem);
    checkBtn.disabled = slots.length === 0;
    newBtn.disabled = false;
    setStatus(instance.missing.length ? `Note: some values couldn't be filled in (${instance.missing.join(', ')}).` : '');
    (slots[0]?.control as HTMLElement | undefined)?.focus();
  }

  function check() {
    if (!instance || slots.length === 0) return;
    let correct = 0;
    for (const s of slots) {
      const ok = s.control.value.trim() !== '' && checkAnswer(s.control.value, s.part.answer);
      if (ok) correct++;
      s.mark.textContent = ok ? '✓' : '✗';
      s.mark.dataset.tone = ok ? 'ok' : 'error';
      s.control.setAttribute('aria-invalid', String(!ok));
    }
    attempted = true;
    solutionBtn.disabled = false;
    if (correct === slots.length) {
      setStatus(slots.length === 1 ? 'Correct!' : `All ${slots.length} correct!`, 'ok');
      const hasNext = levelIndex + 1 < block.levels.length;
      nextBtn.hidden = !hasNext;
      nextBtn.disabled = !hasNext;
    } else {
      setStatus(`${correct} of ${slots.length} correct. Try again, or show the solution.`, 'error');
    }
  }

  function showSolution() {
    if (!instance || !attempted) return;
    solution.replaceChildren(
      h('h4', {}, 'Solution'),
      instance.solutionHtml ? challengeTextEl(instance.solutionHtml, 'zy-solution') : h('p', { class: 'zy-muted' }, 'No worked solution for this level.'),
    );
    typeset(solution);
    solutionBtn.disabled = true;
  }

  checkBtn.addEventListener('click', check);
  newBtn.addEventListener('click', () => void generate(levelIndex));
  nextBtn.addEventListener('click', () => void generate(levelIndex + 1));
  solutionBtn.addEventListener('click', showSolution);
  start.addEventListener('click', () => {
    start.replaceWith(body);
    void generate(0);
  });

  return root;
}
