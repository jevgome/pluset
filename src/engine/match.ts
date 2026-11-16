// Inputs for recreating a student's randomized version of a challenge level from the
// values their zyBooks page shows (the search itself is in python/zymatch.py).

import type { ChallengeBlock } from '../core/model';
import type { MatchRequest } from './runtime';

const HAS_VAR = /\$\{\s*[A-Za-z_]\w*\s*\}/;

/** The level's text that depends on its random values, and its answer templates. */
export function matchInput(block: ChallengeBlock, levelIndex: number, pageText: string, budgetMs = 8000): MatchRequest {
  const level = block.levels[levelIndex];
  if (!level) throw new Error(`Level ${levelIndex + 1} doesn't exist.`);
  const elements = level.questions[0]?.elements ?? [];
  const templates = elements.filter((e) => e.type === 'text' && e.text && HAS_VAR.test(e.text)).map((e) => e.text!);
  const answerTemplates: string[] = [];
  for (const e of elements) {
    if (e.type === 'shortanswer') answerTemplates.push(...e.correctAnswers);
    if (e.type === 'dropdown') {
      for (const o of e.options as { text?: unknown; isCorrectOption?: unknown }[]) {
        if (o?.isCorrectOption === true && typeof o.text === 'string') answerTemplates.push(o.text);
      }
    }
  }
  return { sharedCode: block.sharedCode, levelCode: level.code, templates, answerTemplates, pageText, budgetMs };
}
