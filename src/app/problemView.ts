// One practice problem: gets a ProblemInstance from a source (a book challenge
// level run with a fresh seed, or an AI-generated problem), renders it, checks
// answers, and reveals the solution only after an attempt. Used by the section
// viewer and by practice sessions.

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

/** Produces the problem to show; may report loading progress. */
export type ProblemSource = (onProgress: (stage: string) => void) => Promise<ProblemInstance>;

/** A new randomized version of a book challenge level. */
export const challengeSource =
  (block: ChallengeBlock, levelIndex: number): ProblemSource =>
  async (onProgress) => {
    const level = block.levels[levelIndex];
    if (!level) throw new Error('This level no longer exists.');
    const vars = await runLevel(block.sharedCode, level.code, randomSeed(), onProgress);
    return instantiateLevel(block, levelIndex, vars);
  };

interface Slot {
  part: Extract<ProblemPart, { kind: 'input' | 'dropdown' | 'choices' }>;
  read: () => string;
  setInvalid: (invalid: boolean) => void;
  mark: HTMLElement;
  /** Multiple choice: where the chosen option's explanation appears after checking. */
  feedback?: HTMLElement;
  focus: () => void;
}

export function createProblemView(source: ProblemSource, opts: { onChange?: (o: Outcome) => void } = {}): ProblemView {
  const outcome: Outcome = { attempted: false, firstTryCorrect: false, solved: false, viewedSolution: false };
  const slots: Slot[] = [];
  let instance: ProblemInstance | null = null;
  const uid = Math.random().toString(36).slice(2);

  const problem = h('div', { class: 'zy-practice__problem', 'aria-live': 'polite' });
  const status = h('p', { class: 'zy-practice__status', role: 'status' });
  const checkBtn = h('button', { type: 'button' }, 'Check') as HTMLButtonElement;
  const solutionBtn = h('button', { type: 'button', class: 'secondary' }, 'Show solution') as HTMLButtonElement;
  const solution = h('div', { class: 'zy-practice__solution' });
  const el = h('div', { class: 'zy-problem' }, problem, h('div', { class: 'zy-practice__controls' }, checkBtn, solutionBtn), status, solution);
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
          inputmode: part.answer.kind === 'numeric' ? 'decimal' : 'text',
          autocomplete: 'off',
          spellcheck: 'false',
          'aria-label': part.label,
          ...(part.placeholder ? { placeholder: part.placeholder } : {}),
        }) as HTMLInputElement;
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') check();
        });
        const mark = h('span', { class: 'zy-mark', 'aria-hidden': 'true' });
        slots.push({
          part,
          read: () => input.value,
          setInvalid: (bad) => input.setAttribute('aria-invalid', String(bad)),
          mark,
          focus: () => input.focus(),
        });
        return h('div', { class: 'zy-practice__slot' }, input, mark);
      }
      case 'dropdown': {
        const select = h('select', { 'aria-label': part.label }, h('option', { value: '' }, 'Pick')) as HTMLSelectElement;
        for (const o of part.options) select.append(h('option', { value: o }, o));
        const mark = h('span', { class: 'zy-mark', 'aria-hidden': 'true' });
        slots.push({
          part,
          read: () => select.value,
          setInvalid: (bad) => select.setAttribute('aria-invalid', String(bad)),
          mark,
          focus: () => select.focus(),
        });
        return h('div', { class: 'zy-practice__slot' }, select, mark);
      }
      case 'choices': {
        const name = `choice-${uid}-${part.id}`;
        const list = h('div', { class: 'zy-choice-list', role: 'radiogroup', 'aria-label': 'Choices' });
        const radios: HTMLInputElement[] = [];
        part.options.forEach((html, i) => {
          const radio = h('input', { type: 'radio', name, value: String(i) }) as HTMLInputElement;
          radios.push(radio);
          const label = h('label', { class: 'zy-choice' }, radio, challengeTextEl(html, 'zy-choice__text'));
          list.append(label);
        });
        const mark = h('span', { class: 'zy-mark', 'aria-hidden': 'true' });
        const feedback = h('div', { class: 'zy-choice__feedback' });
        slots.push({
          part,
          read: () => radios.find((r) => r.checked)?.value ?? '',
          setInvalid: (bad) => list.setAttribute('aria-invalid', String(bad)),
          mark,
          feedback,
          focus: () => radios[0]?.focus(),
        });
        return h('div', { class: 'zy-practice__choices' }, list, h('div', { class: 'zy-practice__slot' }, mark, feedback));
      }
      case 'image':
        return part.image.url
          ? h(
              'figure',
              { class: 'zy-ch-figure' },
              h('img', { src: part.image.url, alt: part.image.alt, loading: 'lazy' }),
            )
          : h(
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
      const value = s.read();
      const ok = value.trim() !== '' && checkAnswer(value, s.part.answer);
      if (ok) correct++;
      s.mark.textContent = ok ? '✓' : '✗';
      s.mark.dataset.tone = ok ? 'ok' : 'error';
      s.setInvalid(!ok);
      if (s.feedback && s.part.kind === 'choices') {
        const explanation = s.part.explanations[Number(value)];
        s.feedback.replaceChildren(value !== '' && explanation ? challengeTextEl(explanation, 'zy-choice__explanation') : '');
        typeset(s.feedback);
      }
    }
    const allCorrect = correct === slots.length;
    if (!outcome.attempted) outcome.firstTryCorrect = allCorrect;
    outcome.attempted = true;
    outcome.solved ||= allCorrect;
    solutionBtn.disabled = outcome.viewedSolution || !instance.solutionHtml;
    if (allCorrect) setStatus(slots.length === 1 ? 'Correct!' : `All ${slots.length} correct!`, 'ok');
    else if (slots.length === 1) setStatus('Not quite. Try again, or show the solution.', 'error');
    else setStatus(`${correct} of ${slots.length} correct. Try again, or show the solution.`, 'error');
    changed();
  }

  function showSolution() {
    if (!instance || !outcome.attempted) return;
    solution.replaceChildren(
      h('h4', {}, 'Solution'),
      instance.solutionHtml ? challengeTextEl(instance.solutionHtml, 'zy-solution') : h('p', { class: 'zy-muted' }, 'No worked solution for this problem.'),
    );
    typeset(solution);
    solutionBtn.disabled = true;
    outcome.viewedSolution = true;
    changed();
  }

  checkBtn.addEventListener('click', check);
  solutionBtn.addEventListener('click', showSolution);

  async function load(): Promise<boolean> {
    setStatus('Generating…');
    try {
      instance = await source((stage) => setStatus(stage));
    } catch (e) {
      setStatus(`Couldn't generate this problem: ${e instanceof Error ? e.message : String(e)}`, 'error');
      return false;
    }
    problem.append(...inRows(instance.parts, renderPart));
    typeset(problem);
    checkBtn.disabled = slots.length === 0;
    setStatus(instance.missing.length ? `Note: some values couldn't be filled in (${instance.missing.join(', ')}).` : '');
    if (el.isConnected) slots[0]?.focus();
    return true;
  }

  return { el, ready: load(), outcome: () => ({ ...outcome }) };
}
