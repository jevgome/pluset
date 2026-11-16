// Turns an AI-generated problem (plus, for numeric problems, the variables its
// Python produced) into the same ProblemInstance the practice UI renders for
// book challenge activities.

import type { ImageRef } from '../core/model';
import { fillTemplate, type ProblemInstance, type ProblemPart } from '../engine/instantiate';
import type { LevelVars } from '../engine/runtime';
import type { AiProblem } from './schema';

export function instantiateAiProblem(p: AiProblem, vars: LevelVars, figure: ImageRef | null): ProblemInstance {
  const missing = new Set<string>();
  const fill = (s: string) => fillTemplate(s, vars, missing);
  const parts: ProblemPart[] = [];
  let row = 0;

  if (figure) parts.push({ kind: 'image', image: figure, row: row++ });
  parts.push({ kind: 'text', html: fill(p.prompt), row: row++ });

  switch (p.kind) {
    case 'multiple_choice':
      parts.push({
        kind: 'choices',
        id: 'choices',
        options: p.choices.map((c) => c.text),
        explanations: p.choices.map((c) => c.explanation),
        answer: { kind: 'choice', correct: String(p.choices.findIndex((c) => c.correct)) },
        row: row++,
      });
      break;
    case 'short_answer':
      parts.push({
        kind: 'input',
        id: 'answer',
        label: 'Answer',
        placeholder: null,
        answer: { kind: 'text', answers: p.accepted_answers, caseSensitive: false },
        row: row++,
      });
      break;
    case 'numeric':
      p.answers.forEach((a, i) => {
        const r = row++;
        if (a.label.trim()) parts.push({ kind: 'text', html: fill(a.label), row: r });
        const value = vars[a.variable];
        parts.push({
          kind: 'input',
          id: `answer-${i}`,
          label: a.label.trim() ? fill(a.label).replace(/\\[()]/g, '') : `Answer ${i + 1}`,
          placeholder: null,
          answer: {
            kind: 'numeric',
            answers: typeof value === 'string' ? [value] : [],
            tolerance: { type: 'percent', value: a.tolerance_percent > 0 ? a.tolerance_percent : 5 },
          },
          row: r,
        });
        if (a.unit.trim()) parts.push({ kind: 'text', html: fill(a.unit), row: r });
      });
      break;
  }

  return { levelName: '', parts, solutionHtml: p.solution ? fill(p.solution) : null, missing: [...missing] };
}
