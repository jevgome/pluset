// Turns a challenge level plus the variables produced by its generator code
// into a concrete problem: filled-in text, input slots with answer specs, and the solution.

import type { ChallengeBlock, ChallengeElement, ImageRef } from '../core/model';
import { parseTolerance, type AnswerSpec } from './check';
import type { LevelVars } from './runtime';

export type ProblemPart = (
  | { kind: 'text'; html: string }
  | { kind: 'input'; id: string; label: string; placeholder: string | null; answer: AnswerSpec }
  | { kind: 'dropdown'; id: string; label: string; options: string[]; answer: AnswerSpec }
  /** Multiple choice: option HTML, the correct option's index (as a string), and per-option explanations. */
  | { kind: 'choices'; id: string; options: string[]; explanations: string[]; answer: AnswerSpec }
  | { kind: 'image'; image: ImageRef }
  | { kind: 'unsupported'; type: string }
) & {
  /** Visual line; consecutive parts with the same row render side by side. */
  row: number;
};

export interface ProblemInstance {
  levelName: string;
  parts: ProblemPart[];
  /** Worked solution, with the generated values filled in. */
  solutionHtml: string | null;
  /** Template variables that the code didn't define (shown as-is; indicates a stand-in gap). */
  missing: string[];
}

const TEMPLATE = /\$\{\s*([A-Za-z_]\w*)\s*\}/g;

export function fillTemplate(template: string, vars: LevelVars, missing: Set<string>): string {
  return template.replace(TEMPLATE, (whole, name: string) => {
    const v = vars[name];
    if (v === undefined) {
      missing.add(name);
      return whole;
    }
    return Array.isArray(v) ? v.join(', ') : v;
  });
}

/** Name of the variable if the whole string is a single ${var} reference. */
const soleVariable = (s: string) => /^\s*\$\{\s*([A-Za-z_]\w*)\s*\}\s*$/.exec(s)?.[1] ?? null;

interface RawOption {
  text?: unknown;
  isCorrectOption?: unknown;
  isInvalidOption?: unknown;
  isPythonList?: unknown;
}

function dropdownOptions(el: ChallengeElement, vars: LevelVars, missing: Set<string>) {
  const options: string[] = [];
  let correct: string | null = null;
  for (const raw of el.options as RawOption[]) {
    if (raw?.isInvalidOption === true) continue; // the "Pick" prompt
    const text = typeof raw?.text === 'string' ? raw.text : '';
    const listName = raw?.isPythonList === true ? soleVariable(text) : null;
    const listValue = listName ? vars[listName] : undefined;
    const values = Array.isArray(listValue) ? listValue : [fillTemplate(text, vars, missing)];
    if (listName && listValue === undefined) missing.add(listName);
    for (const v of values) {
      if (!options.includes(v)) options.push(v);
      if (raw?.isCorrectOption === true) correct = v;
    }
  }
  return { options, correct };
}

function orderOptions(options: string[], method: string | null): string[] {
  if (method === 'sort') return [...options].sort((a, b) => a.localeCompare(b));
  if (method === 'reverse-sort') return [...options].sort((a, b) => b.localeCompare(a));
  return options;
}

function answerSpecFor(el: ChallengeElement, vars: LevelVars, missing: Set<string>): AnswerSpec {
  const answers = el.correctAnswers.map((a) => fillTemplate(a, vars, missing).trim());
  const method = el.assessmentMethod ?? '';
  if (method === 'numericalMatch' || method === 'decimal' || method === '') {
    return { kind: 'numeric', answers, tolerance: parseTolerance(el.assessmentProperties) };
  }
  return { kind: 'text', answers, caseSensitive: false };
}

export function instantiateLevel(block: ChallengeBlock, levelIndex: number, vars: LevelVars, questionIndex = 0): ProblemInstance {
  const level = block.levels[levelIndex];
  if (!level) throw new Error(`Level ${levelIndex + 1} doesn't exist.`);
  const question = level.questions[questionIndex] ?? level.questions[0];
  const missing = new Set<string>();
  const parts: ProblemPart[] = [];

  for (const el of question?.elements ?? []) {
    switch (el.type) {
      case 'text': {
        const text = (el.text ?? '').trim();
        if (text && text !== 'add text') parts.push({ kind: 'text', html: fillTemplate(text, vars, missing), row: el.row });
        break;
      }
      case 'shortanswer':
        parts.push({
          kind: 'input',
          id: el.id,
          label: el.ariaLabel ? fillTemplate(el.ariaLabel, vars, missing) : 'Answer',
          placeholder: el.placeholder ? fillTemplate(el.placeholder, vars, missing) : null,
          answer: answerSpecFor(el, vars, missing),
          row: el.row,
        });
        break;
      case 'dropdown': {
        const { options, correct } = dropdownOptions(el, vars, missing);
        parts.push({
          kind: 'dropdown',
          id: el.id,
          label: el.ariaLabel ? fillTemplate(el.ariaLabel, vars, missing) : 'Choose',
          options: orderOptions(options, el.optionOrdering),
          answer: { kind: 'choice', correct: correct ?? '' },
          row: el.row,
        });
        break;
      }
      case 'image':
        if (el.image) parts.push({ kind: 'image', image: el.image, row: el.row });
        break;
      default:
        parts.push({ kind: 'unsupported', type: el.type, row: el.row });
    }
  }

  const solutionHtml = level.explanationTemplate ? fillTemplate(level.explanationTemplate, vars, missing) : null;
  return { levelName: level.name, parts, solutionHtml, missing: [...missing] };
}
