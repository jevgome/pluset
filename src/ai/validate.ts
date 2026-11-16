// Local checks on AI-generated problems, before any AI review:
// structural sanity, numeric code that actually runs and produces numbers for
// every answer, and a book quote that really appears in the book material.

import { parseNumber } from '../engine/check';
import type { LevelVars } from '../engine/runtime';
import { instantiateAiProblem } from './instance';
import type { AiProblem } from './schema';

export type CodeRunner = (code: string, seed: number) => Promise<LevelVars>;

export interface Validation {
  ok: boolean;
  reasons: string[];
  /** Variables from the first successful run (numeric problems), for review and preview. */
  sampleVars: LevelVars;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\\[a-z]+/g, ' ') // LaTeX commands
    .replace(/[^a-z0-9.]+/g, ' ')
    .split(' ')
    .filter((w) => w && w !== '.');

/**
 * True if the quote appears in the book: the longest run of consecutive quote words
 * found in the book must cover most of the quote (allows small formatting differences).
 */
export function quoteInBook(quote: string, bookText: string): boolean {
  const q = words(quote);
  if (q.length < 4) return false;
  const b = words(bookText);
  // Longest common contiguous word run (rolling DP over the book).
  let best = 0;
  let prev = new Uint16Array(q.length + 1);
  let cur = new Uint16Array(q.length + 1);
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= q.length; j++) {
      cur[j] = b[i - 1] === q[j - 1] ? prev[j - 1]! + 1 : 0;
      if (cur[j]! > best) best = cur[j]!;
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return best >= Math.min(q.length, Math.max(6, Math.ceil(q.length * 0.6)));
}

const HAS_PLACEHOLDER = /\$\{\s*[A-Za-z_]\w*\s*\}/;

export async function validateProblem(p: AiProblem, bookText: string, run: CodeRunner, sections: string[]): Promise<Validation> {
  const reasons: string[] = [];
  let sampleVars: LevelVars = {};

  if (!p.prompt.trim()) reasons.push('empty prompt');
  if (!sections.includes(p.section)) reasons.push(`unknown section "${p.section}"`);
  if (!quoteInBook(p.book_quote, bookText)) reasons.push('its book quote was not found in the book');

  switch (p.kind) {
    case 'multiple_choice': {
      const correct = p.choices.filter((c) => c.correct).length;
      if (p.choices.length < 2 || p.choices.length > 6) reasons.push(`${p.choices.length} choices`);
      if (correct !== 1) reasons.push(`${correct} choices marked correct`);
      if (p.choices.some((c) => !c.text.trim())) reasons.push('an empty choice');
      if (new Set(p.choices.map((c) => c.text.trim().toLowerCase())).size !== p.choices.length) reasons.push('duplicate choices');
      if (HAS_PLACEHOLDER.test(p.prompt)) reasons.push('placeholders in a non-numeric problem');
      break;
    }
    case 'short_answer':
      if (!p.accepted_answers.some((a) => a.trim())) reasons.push('no accepted answers');
      if (HAS_PLACEHOLDER.test(p.prompt)) reasons.push('placeholders in a non-numeric problem');
      break;
    case 'numeric': {
      if (!p.python_code.trim()) reasons.push('no Python code');
      if (p.answers.length === 0) reasons.push('no answers');
      if (reasons.length) break;
      // Run with several seeds: every run must produce numeric answers and fill every placeholder.
      for (const seed of [11, 22, 33]) {
        let vars: LevelVars;
        try {
          vars = await run(p.python_code, seed);
        } catch (e) {
          reasons.push(`its code failed: ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
        if (seed === 11) sampleVars = vars;
        for (const a of p.answers) {
          const v = vars[a.variable];
          if (typeof v !== 'string' || parseNumber(v) === null) {
            reasons.push(`answer variable "${a.variable}" is not a number (${JSON.stringify(v)})`);
          }
        }
        const missing = instantiateAiProblem(p, vars, null).missing;
        if (missing.length) reasons.push(`undefined placeholders: ${missing.join(', ')}`);
        if (reasons.length) break;
      }
      break;
    }
  }
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)], sampleVars };
}
