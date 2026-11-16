// One generated challenge problem: runs the book's generator code with a fresh
// seed, renders the problem, checks answers with the book's tolerances, and
// reveals the worked solution only after an attempt. Used by the section
// viewer's practice panel and by practice sessions.

import type { ChallengeBlock } from '../core/model';
import { checkAnswer } from '../engine/check';
import { randomSeed, runLevel } from '../engine/client';
import { instantiateLevel, type ProblemInstance, type ProblemPart } from '../engine/instantiate';
import { challengeTextEl, h, inRows, typeset } from './dom';

export interface Outcome {
  /** The student checked at least once. */
  attempted: boolean;
  /** Everything was right on the first check. */
  firstTryCorrect: boolean;
  /** Everything was right on some check. */
  solved: boolean;
  viewedSolution: boolean;
}

export interface ProblemView {
  el: HTMLElement;
  /** Resolves true once the problem is shown, false if generation failed. */
  ready: Promise<boolean>;
  outcome(): Outcome;
}

interface Slot {
  part: Extract<ProblemPart, { kind: 'input' | 'dropdown' }>;
  control: HTMLInputElement | HTMLSelectElement;
  mark: HTMLElement;
}

export function createProblemView(
  block: ChallengeBlock,
  levelIndex: number,
  opts: { onChange?: (o: Outcome) => void } = {},
): ProblemView {
  const outcome: Outcome = { attempted: false, firstTryCorrect: false, solved: false, viewedSolution: false };
  const slots: Slot[] = [];
  let instance: ProblemInstance | null = null;

  const problem = h('div', { class: 'zy-practice__problem', 'aria-live': 'polite' });
  const status = h('p', { class: 'zy-practice__status', role: 'status' });
  const checkBtn = h('button', { type: 'button' }, 'Check') as HTMLButtonElement;
  const solutionBtn = h('button', { type: 'button', class: 'secondary' }, 'Show solution') as HTMLButtonElement;
  const solution = h('div', { class: 'zy-practice__solution' });
  const el = h(
    'div',
    { class: 'zy-problem' },
    problem,
    h('div', { class: 'zy-practice__controls' }, checkBtn, solutionBtn),
    status,
    solution,
  );
  checkBtn.disabled = true;
  solutionBtn.disabled = true;

  const setStatus = (text: string, tone: 'ok' | 'error' | 'info' = 'info') => {
    status.textContent = text;
    status.dataset.tone = tone;
  };
  const changed = () => opts.onChange?.({ ...outcome });

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
    const allCorrect = correct === slots.length;
    if (!outcome.attempted) outcome.firstTryCorrect = allCorrect;
    outcome.attempted = true;
    outcome.solved ||= allCorrect;
    solutionBtn.disabled = outcome.viewedSolution;
    if (allCorrect) setStatus(slots.length === 1 ? 'Correct!' : `All ${slots.length} correct!`, 'ok');
    else setStatus(`${correct} of ${slots.length} correct. Try again, or show the solution.`, 'error');
    changed();
  }

  function showSolution() {
    if (!instance || !outcome.attempted) return;
    solution.replaceChildren(
      h('h4', {}, 'Solution'),
      instance.solutionHtml
        ? challengeTextEl(instance.solutionHtml, 'zy-solution')
        : h('p', { class: 'zy-muted' }, 'No worked solution for this level.'),
    );
    typeset(solution);
    solutionBtn.disabled = true;
    outcome.viewedSolution = true;
    changed();
  }

  checkBtn.addEventListener('click', check);
  solutionBtn.addEventListener('click', showSolution);

  async function generate(): Promise<boolean> {
    setStatus('Generating… (the first one takes a few seconds while Python loads)');
    const level = block.levels[levelIndex];
    if (!level) {
      setStatus('This level no longer exists.', 'error');
      return false;
    }
    try {
      const vars = await runLevel(block.sharedCode, level.code, randomSeed());
      instance = instantiateLevel(block, levelIndex, vars);
    } catch (e) {
      setStatus(`Couldn't generate this problem: ${e instanceof Error ? e.message : String(e)}`, 'error');
      return false;
    }
    problem.append(...inRows(instance.parts, renderPart));
    typeset(problem);
    checkBtn.disabled = slots.length === 0;
    setStatus(instance.missing.length ? `Note: some values couldn't be filled in (${instance.missing.join(', ')}).` : '');
    if (el.isConnected) (slots[0]?.control as HTMLElement | undefined)?.focus();
    return true;
  }

  return { el, ready: generate(), outcome: () => ({ ...outcome }) };
}
