// Runs AI-generated problems through the same Python worker as the book's code.

import type { ImageRef } from '../core/model';
import { instantiateAiProblem } from '../ai/instance';
import type { StoredAiProblem } from '../ai/store';
import type { CodeRunner } from '../ai/validate';
import { randomSeed, runLevel } from '../engine/client';
import type { ProblemSource } from './problemView';

/** Helpers AI-written code may use without importing (see the generation prompt). */
export const AI_PRELUDE = 'from zyversions import zyv_sig_fig_round, convert_to_scinot, build_placeholder';

export const runAiCode: CodeRunner = (code, seed) => runLevel(AI_PRELUDE, code, seed);

/** A problem source for a stored AI problem; numeric problems get new values each time. */
export const aiSource =
  (p: StoredAiProblem, figure: ImageRef | null): ProblemSource =>
  async (onProgress) => {
    const vars = p.problem.kind === 'numeric' ? await runLevel(AI_PRELUDE, p.problem.python_code, randomSeed(), onProgress) : {};
    return instantiateAiProblem(p.problem, vars, figure);
  };
