// The structured-output formats exchanged with the AI, as JSON Schema (sent to
// the provider) plus matching TypeScript types. Kept flat with every field
// required (empty values when not applicable) so every provider's structured
// output mode can follow it.

export type AiProblemKind = 'multiple_choice' | 'short_answer' | 'numeric';

export interface AiChoice {
  text: string;
  correct: boolean;
  explanation: string;
}

export interface AiNumericAnswer {
  /** Shown next to the input, e.g. "(a) Δp =". */
  label: string;
  /** Python variable holding the answer. */
  variable: string;
  /** Units shown after the input (LaTeX allowed), or "". */
  unit: string;
  tolerance_percent: number;
}

export interface AiProblem {
  kind: AiProblemKind;
  /** Section label the problem belongs to, e.g. "8.5". */
  section: string;
  /** Which book items the problem is modeled on (activity captions, figure/example numbers). */
  based_on: string;
  /** Verbatim excerpt from the book material that supports the problem's key fact or equation. */
  book_quote: string;
  /** Problem text. Numeric problems reference generated values as ${var}. */
  prompt: string;
  choices: AiChoice[];
  accepted_answers: string[];
  /** Python that sets every ${var} used in the prompt/solution and every answer variable. */
  python_code: string;
  answers: AiNumericAnswer[];
  /** Explanation (multiple choice / short answer) or worked solution with ${var} (numeric). */
  solution: string;
  /** ID of a book figure to show with the problem, or "". */
  figure_id: string;
}

export interface GenerationOutput {
  problems: AiProblem[];
}

export interface ProblemReview {
  /** Index into the list of reviewed problems. */
  index: number;
  /** Everything needed to solve it is in the book material. */
  grounded: boolean;
  /** The marked answer / computed answers are correct. */
  answer_correct: boolean;
  /** Facts, equations, data or terms used that the book material doesn't contain. */
  outside_knowledge: string[];
  /** Other problems: ambiguous wording, more than one right choice, copies a book problem, etc. */
  issues: string;
  /** Keep it: grounded, correct, clear and not a copy. */
  keep: boolean;
}

export interface ReviewOutput {
  reviews: ProblemReview[];
}

const str = { type: 'string' } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const GENERATION_SCHEMA = obj({
  problems: {
    type: 'array',
    items: obj({
      kind: { type: 'string', enum: ['multiple_choice', 'short_answer', 'numeric'] },
      section: str,
      based_on: str,
      book_quote: str,
      prompt: str,
      choices: { type: 'array', items: obj({ text: str, correct: { type: 'boolean' }, explanation: str }) },
      accepted_answers: { type: 'array', items: str },
      python_code: str,
      answers: {
        type: 'array',
        items: obj({ label: str, variable: str, unit: str, tolerance_percent: { type: 'number' } }),
      },
      solution: str,
      figure_id: str,
    }),
  },
});

export const REVIEW_SCHEMA = obj({
  reviews: {
    type: 'array',
    items: obj({
      index: { type: 'integer' },
      grounded: { type: 'boolean' },
      answer_correct: { type: 'boolean' },
      outside_knowledge: { type: 'array', items: str },
      issues: str,
      keep: { type: 'boolean' },
    }),
  },
});
