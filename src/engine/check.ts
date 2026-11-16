// Answer checking that follows the book's own rules (tolerances, accepted answers).

export type Tolerance = { type: 'percent' | 'absolute'; value: number };

export type AnswerSpec =
  | { kind: 'numeric'; answers: string[]; tolerance: Tolerance }
  | { kind: 'choice'; correct: string }
  | { kind: 'text'; answers: string[]; caseSensitive: boolean };

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace('%', ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * zyBooks stores tolerances in several shapes:
 *   { tolerancePercentage: "5" }   { tolerance: "5%" }   { tolerance: "0" }   { toleranceAbsoluteValue: ".005" }
 */
export function parseTolerance(props: Record<string, unknown>): Tolerance {
  const pct = num(props.tolerancePercentage);
  if (pct !== null) return { type: 'percent', value: pct };
  const abs = num(props.toleranceAbsoluteValue);
  if (abs !== null) return { type: 'absolute', value: abs };
  const raw = props.tolerance;
  if (typeof raw === 'string' || typeof raw === 'number') {
    const value = num(raw);
    if (value !== null) return { type: String(raw).trim().endsWith('%') ? 'percent' : 'absolute', value };
  }
  return { type: 'absolute', value: 0 };
}

/** Parses what a student types: "1,234.5", "−3", "1.2e-3", "1.2 × 10^-3". */
export function parseNumber(input: string): number | null {
  let s = input.trim().replace(/[−–]/g, '-').replace(/,/g, '').replace(/\s+/g, '');
  const sci = /^([+-]?(?:\d+\.?\d*|\.\d+))[x×*]10\^?\(?([+-]?\d+)\)?$/i.exec(s);
  if (sci) s = `${sci[1]}e${sci[2]}`;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function withinTolerance(value: number, answer: number, tol: Tolerance): boolean {
  const allowed = tol.type === 'percent' ? Math.abs(answer) * (tol.value / 100) : tol.value;
  // Small slack for floating-point noise in the stored answer.
  return Math.abs(value - answer) <= allowed + 1e-9 * Math.max(1, Math.abs(answer));
}

const normalizeText = (s: string, caseSensitive: boolean) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return caseSensitive ? t : t.toLowerCase();
};

export function checkAnswer(input: string, spec: AnswerSpec): boolean {
  switch (spec.kind) {
    case 'numeric': {
      const value = parseNumber(input);
      if (value === null) return false;
      return spec.answers.some((a) => {
        const answer = parseNumber(a);
        return answer !== null && withinTolerance(value, answer, spec.tolerance);
      });
    }
    case 'choice':
      return input === spec.correct;
    case 'text': {
      const typed = parseNumber(input);
      return spec.answers.some((a) => {
        if (normalizeText(a, spec.caseSensitive) === normalizeText(input, spec.caseSensitive)) return true;
        // "1.5" and "1.50" are the same answer.
        const n = parseNumber(a);
        return n !== null && typed !== null && n === typed;
      });
    }
  }
}

export function describeTolerance(t: Tolerance): string | null {
  if (t.value === 0) return null;
  return t.type === 'percent' ? `±${t.value}%` : `±${t.value}`;
}
