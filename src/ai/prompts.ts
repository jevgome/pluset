// Prompts for generating and reviewing problems. The system prompt and the book
// material are identical across the generation and review requests, so a
// provider with prompt caching can reuse them.

export const SYSTEM_PROMPT = `You help a student practice from their own textbook, an interactive zyBooks book. You will receive the book material the student has captured: the reading, figures (as images and/or descriptions), tables, worked examples, and the book's own activities with their answers.

The book material is the only source you may use. Every concept, equation, definition, term, data value (coefficients, properties, table and chart values), assumption and solution method you rely on must come from it, using the book's own notation and terminology. If something isn't in the book material, don't use it, even if you know it to be true.`;

export interface GenerationPlan {
  count: number;
  sections: string[];
  mix: { multipleChoice: number; shortAnswer: number; numeric: number };
  /** Prompts of problems already generated for these sections, to avoid repeats. */
  existingPrompts: string[];
}

export function generationInstructions(plan: GenerationPlan): string {
  const existing = plan.existingPrompts.length
    ? `\n\nThese problems were already generated for the student; make different ones:\n${plan.existingPrompts.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
    : '';
  return `Write ${plan.count} new practice problems for section${plan.sections.length > 1 ? 's' : ''} ${plan.sections.join(', ')}, spread across the sections. Aim for about ${plan.mix.multipleChoice} multiple choice, ${plan.mix.shortAnswer} short answer and ${plan.mix.numeric} numeric problems; if a section's material doesn't support numeric problems, use conceptual ones instead.

Make them very similar in style, scope and difficulty to the book's own activities, but not copies: change the scenario, the values, or what is asked.
- multiple_choice and short_answer: like the participation activities. Conceptual checks of the reading, often fill-in-the-blank ("_____").
- numeric: like the challenge activities. A "Given / Find" setup with one or more parts that are computed from given values, using the book's equations, tables and figures.

Grounding rules:
- Use only what is in the book material. Any value the student needs that isn't a book table or chart value (fluid properties, dimensions, etc.) must be stated in the problem, the way the book's challenge activities state them.
- If a problem relies on reading a book table, chart or figure, set figure_id to that image's ID from "[Image <id>: ...]" and only use values the book states or shows clearly.
- book_quote: copy, character for character, one to three sentences or one equation line from the book material that the problem depends on most. It is checked against the book automatically.
- based_on: name the activities, examples, figures or tables the problem is modeled on.
- section: the label of the section the problem belongs to (one of ${plan.sections.join(', ')}).

Formatting:
- Math in LaTeX with \\( ... \\) inline and \\[ ... \\] for display. Basic HTML (<b>, <i>, <br>) is allowed. No Markdown.
- Fields that don't apply to a problem's kind are empty ("" or []).

multiple_choice: 3 or 4 choices, exactly one correct, and an explanation for every choice in the book's style. No "all/none of the above". solution: a one- or two-sentence explanation of the key idea.

short_answer: the answer is a single number, word or short term. accepted_answers lists every acceptable form (e.g. "1.5", "1.50"). solution explains the answer.

numeric:
- python_code is Python 3 that picks the given values at random within realistic ranges (random.choice, random.randint, or pick_from(list) / pick_from_range(low, high) for integers), computes the answers, and sets every variable used anywhere as \${name} in prompt, solution, answers' label or unit. Available without importing: math, random, zyv_sig_fig_round(x, n) (returns a string with n significant figures), convert_to_scinot(x, n) (returns (coefficient_str, exponent)), pick_from, pick_from_range. No other imports, no printing, no file access.
- Compute answers from the same rounded values shown to the student, so the student can reproduce them.
- prompt shows the values as \${name} placeholders, e.g. "Water flows at \\(\${Q}~\\mathrm{m^3/s}\\)".
- answers: one entry per input box. label is shown before the box (e.g. "\\((a)\\ \\Delta p =\\)"), variable names the Python variable with the numeric answer, unit is shown after the box (e.g. "\\(\\mathrm{kPa}\\)"), tolerance_percent is 5 unless the book's similar activity uses another tolerance.
- solution is a step-by-step worked solution in the style of the book's challenge solutions, with intermediate values as \${name} placeholders computed in python_code (use zyv_sig_fig_round for displayed values).${existing}`;
}

export function reviewInstructions(candidates: string): string {
  return `Below are candidate practice problems generated for the student from the book material above. Review each one strictly.

For each problem:
- grounded: true only if everything needed to understand and solve it (concepts, equations, data, terminology, methods) is in the book material or stated in the problem itself.
- outside_knowledge: anything it uses that the book material doesn't contain (empty if none).
- answer_correct: solve it yourself from the book material. For multiple choice, exactly one choice must be correct and it must be the one marked correct. For short answer, the accepted answers must be right. For numeric problems, one randomized instance is shown with the computed answers; check them.
- issues: anything else wrong: ambiguous or confusing wording, a missing given value, a figure needed but not available, more than one defensible answer, or a near copy of one of the book's own activities. Empty if none.
- keep: true only if grounded, answer_correct, and no serious issues.

Return one review per problem, with index matching the problem number.

${candidates}`;
}
