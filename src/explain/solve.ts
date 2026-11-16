// Turns the matcher's results for each level of a challenge activity into what the
// "Show answer" button displays: the level(s) whose text best matches the page, with
// that version's answers and the book's worked solution.
//
// Pure (no DOM): runs in the service worker and in tests.

import { htmlToText } from '../ai/text';
import type { ChallengeBlock } from '../core/model';
import { expandZyMarkup, normalizeLatex } from '../core/zymarkup';
import { instantiateLevel } from '../engine/instantiate';
import type { MatchRequest, MatchResult } from '../engine/runtime';
import type { SolveResponse, SolvedLevel } from './messages';

/** A level whose filled text differs from the page by more than this share of its words and numbers isn't shown. */
export const MAX_MISMATCH = 0.2;

const VAR = /\$\{\s*([A-Za-z_]\w*)\s*\}/g;

/** Long float strings ("12.345678901") shortened to 6 significant digits; book-formatted values kept as is. */
function formatValue(v: string): string {
  const t = v.trim();
  if (t.length <= 9 || !/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(t)) return t;
  return String(Number(Number(t).toPrecision(6)));
}

function mismatch(r: Extract<MatchResult, { ok: true }>): number {
  if (r.points === 0) return 0; // nothing random: everyone has the same version
  return r.size ? r.score / r.size : 1;
}

export function solvedLevels(block: ChallengeBlock, requests: MatchRequest[], results: MatchResult[]): SolveResponse {
  const scored = results.map((r, i) => ({ r, i })).filter((x): x is { r: Extract<MatchResult, { ok: true }>; i: number } => x.r.ok);
  if (!scored.length) {
    const err = results.find((r): r is Extract<MatchResult, { ok: false }> => !r.ok);
    return { ok: false, error: `Couldn’t run this activity’s generator code: ${err?.error ?? 'no levels'}` };
  }
  const best = Math.min(...scored.map((x) => mismatch(x.r)));
  if (best > MAX_MISMATCH) {
    return {
      ok: false,
      error:
        'Couldn’t recreate your version: the numbers on the page don’t match what this activity’s code produces. ' +
        'If the activity changed, recapture the section in the Pluset app and click “Show answer” again.',
    };
  }

  // Levels often share their "Given" text; among equally good matches, the level with the
  // most matching text is the one on the page (its own questions matched too).
  const close = scored.filter((x) => mismatch(x.r) <= best + 1e-9);
  const most = Math.max(...close.map((x) => x.r.size));
  const levels: SolvedLevel[] = close
    .filter((x) => x.r.size === most)
    .map(({ r, i }) => {
      const inst = instantiateLevel(block, i, r.vars);
      const names = [...new Set(requests[i]!.templates.flatMap((t) => [...t.matchAll(VAR)].map((m) => m[1]!)))];
      const answers = inst.parts.flatMap((p) => {
        if (p.kind === 'input' && p.answer.kind === 'numeric') return [{ label: p.label, value: p.answer.answers.map(formatValue).join(' or ') }];
        if (p.kind === 'input' && p.answer.kind === 'text') return [{ label: p.label, value: p.answer.answers.join(' or ') }];
        if (p.kind === 'dropdown' && p.answer.kind === 'choice') return [{ label: p.label, value: p.answer.correct }];
        return [];
      });
      return {
        name: block.levels[i]!.name || `Level ${i + 1}`,
        exact: r.score === 0,
        ambiguous: r.ambiguous,
        shown: names.flatMap((n): [string, string][] => {
          const v = r.vars[n];
          return v === undefined ? [] : [[n, Array.isArray(v) ? v.join(', ') : v]];
        }),
        answers,
        solution: inst.solutionHtml ? htmlToText(normalizeLatex(expandZyMarkup(inst.solutionHtml))).trim() : null,
      };
    });
  return { ok: true, levels };
}
