// Prompt for explaining one zyBooks question to the student, grounded in the section.

import { SYSTEM_PROMPT } from '../ai/prompts';
import type { ExplainItem } from './items';

export const EXPLAIN_SYSTEM = SYSTEM_PROMPT;

export const EXPLAIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'reasoning', 'key_idea'],
  properties: {
    answer: { type: 'string', description: 'The final answer, short. For several parts, one line per part.' },
    reasoning: { type: 'string', description: 'Step-by-step reasoning that leads to the answer.' },
    key_idea: { type: 'string', description: 'One sentence: the concept from the book this question tests.' },
  },
} as const;

export interface Explanation {
  answer: string;
  reasoning: string;
  key_idea: string;
}

/** `pageText` is what the zyBooks page currently shows for the activity (needed for randomized challenge values). */
export function explainInstructions(item: ExplainItem, pageText: string): string {
  const where = `${item.kind === 'challenge' ? 'challenge' : 'participation'} activity ${item.number}${item.caption ? ` ("${item.caption}")` : ''}`;
  const question =
    item.kind === 'challenge'
      ? `The student is working on ${where}. Its values are randomized per student, so use the problem exactly as their page shows it:\n\n${pageText.trim() || '(The page text could not be read. Explain the method using the book’s worked instance of this activity instead, and say that the student should plug in their own values.)'}\n\nIf the page shows more than one level or part, solve the one that has empty or incorrect answer boxes; otherwise solve the first.`
      : `The student is working on question ${item.questionIndex + 1} of ${where}:\n\n${item.prompt}${item.bookAnswer ? `\n\nThe book's answer: ${item.bookAnswer}` : ''}${item.bookExplanation ? `\nThe book's explanation: ${item.bookExplanation}` : ''}${pageText.trim() ? `\n\nWhat the page currently shows for this activity:\n${pageText.trim()}` : ''}`;

  return `${question}

Explain this question to the student like a patient tutor so they understand it and could answer similar questions on their own.
- answer: the correct answer, exactly as the student should enter or choose it. If the book gives the answer, use it.
- reasoning: numbered steps that get from the question to the answer, citing the book's definitions, equations, figures or tables by name or number. For calculations, show the equation, the values substituted with units, and the intermediate results. For multiple choice, also say briefly why each tempting wrong choice is wrong.
- key_idea: the one concept from the book that the question tests.

Use only the book material. Math in LaTeX with \\( ... \\) inline and \\[ ... \\] for display. Plain text otherwise: no Markdown, no HTML.`;
}
