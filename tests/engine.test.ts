import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPyodide } from 'pyodide';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ChallengeBlock } from '../src/core/model';
import { normalizeActivityResource } from '../src/core/normalize';
import { checkAnswer, parseNumber, parseTolerance } from '../src/engine/check';
import { fillTemplate, instantiateLevel } from '../src/engine/instantiate';
import { createLevelRunner, type LevelRunner } from '../src/engine/runtime';

describe('answer checking', () => {
  it('parses the tolerance formats zyBooks uses', () => {
    expect(parseTolerance({ tolerancePercentage: '5' })).toEqual({ type: 'percent', value: 5 });
    expect(parseTolerance({ tolerance: '3%' })).toEqual({ type: 'percent', value: 3 });
    expect(parseTolerance({ tolerance: '0' })).toEqual({ type: 'absolute', value: 0 });
    expect(parseTolerance({ toleranceAbsoluteValue: '.005' })).toEqual({ type: 'absolute', value: 0.005 });
    expect(parseTolerance({})).toEqual({ type: 'absolute', value: 0 });
  });

  it('parses typed numbers', () => {
    expect(parseNumber(' 1,234.5 ')).toBe(1234.5);
    expect(parseNumber('−3')).toBe(-3);
    expect(parseNumber('1.2e-3')).toBeCloseTo(0.0012);
    expect(parseNumber('1.2 × 10^-3')).toBeCloseTo(0.0012);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('1.2.3')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });

  it('applies percent and absolute tolerances', () => {
    const pct = { kind: 'numeric' as const, answers: ['100'], tolerance: { type: 'percent' as const, value: 5 } };
    expect(checkAnswer('104.9', pct)).toBe(true);
    expect(checkAnswer('105.1', pct)).toBe(false);
    expect(checkAnswer('95', pct)).toBe(true);
    const abs = { kind: 'numeric' as const, answers: ['0.0215'], tolerance: { type: 'absolute' as const, value: 0.0005 } };
    expect(checkAnswer('0.021', abs)).toBe(true);
    expect(checkAnswer('0.0209', abs)).toBe(false);
    const exact = { kind: 'numeric' as const, answers: ['0'], tolerance: { type: 'percent' as const, value: 0 } };
    expect(checkAnswer('0', exact)).toBe(true);
    expect(checkAnswer('0.0', exact)).toBe(true);
    expect(checkAnswer('0.001', exact)).toBe(false);
  });

  it('checks choices and text', () => {
    expect(checkAnswer('laminar', { kind: 'choice', correct: 'laminar' })).toBe(true);
    expect(checkAnswer('turbulent', { kind: 'choice', correct: 'laminar' })).toBe(false);
    expect(checkAnswer(' Laminar  flow', { kind: 'text', answers: ['laminar flow'], caseSensitive: false })).toBe(true);
  });

  it('fills templates and reports missing variables', () => {
    const missing = new Set<string>();
    expect(fillTemplate('h = ${h3} in, ${ nope }', { h3: '12' }, missing)).toBe('h = 12 in, ${ nope }');
    expect([...missing]).toEqual(['nope']);
  });
});

describe('Python stand-ins', { timeout: 120_000 }, () => {
  let py: Awaited<ReturnType<typeof loadPyodide>>;
  let runner: LevelRunner;
  beforeAll(async () => {
    py = await loadPyodide();
    runner = createLevelRunner(py);
  }, 120_000);

  const evalVars = (code: string, seed = 1) => {
    const r = runner.run('', code, seed);
    if (!r.ok) throw new Error(r.error);
    return r.vars;
  };

  it('rounds to significant figures as strings', () => {
    const v = evalVars(`
from zyversions import zyv_sig_fig_round as r
cases = [r(123.456, 3), r(0.000123456, 2), r(12345, 3), r(9.996, 3), r(-0.04567, 2), r(0, 3), r(1200.0, 2), r(0.1, 3), r(2.5e-7, 2), r('3.14159', 4)]
`);
    expect(v.cases).toEqual(['123', '0.00012', '12300', '10.0', '-0.046', '0', '1200', '0.100', '0.00000025', '3.142']);
  });

  it('converts to scientific notation', () => {
    const v = evalVars(`
from zyversions import convert_to_scinot as c
a = c(12345)
b = c(0.000456789, 2)
d = c(9.9999e4, 3)
`);
    expect(v.a).toEqual(['1.23', '4']); // tuples export as lists
    expect(v.b).toEqual(['4.6', '-4']);
    expect(v.d).toEqual(['1.00', '5']);
  });

  it('builds placeholders with the answer’s shape that are not acceptable answers', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const v = evalVars(`
from zyversions import build_placeholder as b
p1 = b('123.4', 5)
p2 = b('0.00512', 5)
p3 = b('4500', 10)
p4 = b('0', 0)
`, seed);
      expect(String(v.p1)).toMatch(/^\d{3}\.\d$/);
      expect(Math.abs(Number(v.p1) - 123.4)).toBeGreaterThan(123.4 * 0.05);
      expect(String(v.p2)).toMatch(/^0\.00\d{3}$/);
      expect(Math.abs(Number(v.p2) - 0.00512)).toBeGreaterThan(0.00512 * 0.05);
      expect(String(v.p3)).toMatch(/^\d{4}$/);
      expect(Number(v.p4)).not.toBe(0);
    }
  });

  it('provides eqat helpers and zyBooks built-ins', () => {
    const v = evalVars(`
from eqat import rand, rint, decimal, ln, e, pi
xs = [rint(11) for _ in range(500)]
lo, hi = min(xs), max(xs)
d = decimal(2, 0.12345)
picked = pick_from([7])
ranged = pick_from_range(3, 3)
`);
    expect([v.lo, v.hi]).toEqual(['0', '10']);
    expect(v.d).toBe('0.12');
    expect(v.picked).toBe('7');
    expect(v.ranged).toBe('3');
  });

  it('is deterministic for a seed and reports errors instead of throwing', () => {
    const code = 'import random\nx = random.randint(1, 10**9)';
    expect(evalVars(code, 42).x).toBe(evalVars(code, 42).x);
    const bad = runner.run('', 'x = 1/0', 1);
    expect(bad).toEqual({ ok: false, error: 'ZeroDivisionError: division by zero' });
  });

  it('blocks imports that reach the browser or the interpreter', () => {
    for (const mod of ['js', 'pyodide', 'sys', 'importlib', 'os']) {
      const r = runner.run('', `import ${mod}`, 1);
      expect(r).toEqual({ ok: false, error: `ImportError: import of '${mod}' is not allowed in problem code` });
    }
    expect(runner.run('', 'from js import fetch', 1).ok).toBe(false);
    expect(runner.run('', "x = __import__('js')", 1).ok).toBe(false);
    expect(runner.run('', "open('/etc/passwd')", 1).ok).toBe(false);
    // Ordinary modules still work, including ones that import blocked modules internally.
    expect(runner.run('', 'import math, random, re, decimal, unittest\nfrom fractions import Fraction\nx = Fraction(1, 3)', 1).ok).toBe(true);
  });

  it('unescapes HTML-escaped code', () => {
    expect(evalVars('ok = 1 &lt; 2 and 3 &gt; 2\ns = r"a &amp; b"').ok).toBe('True');
    expect(evalVars('s = r"a &amp; b"').s).toBe('a & b');
  });

  // Every challenge level in the real captured data (gitignored; runs only when present locally).
  const root = fileURLToPath(new URL('..', import.meta.url));
  const samplePath = [`${root}samples/activity_data.json`, `${root}activity_data.json`].find(existsSync);

  it.skipIf(!samplePath)('runs every captured challenge level and produces checkable answers', () => {
    const data = JSON.parse(readFileSync(samplePath!, 'utf8'));
    const blocks = data.activity_data
      .flatMap((s: { section_activity_data: { content_resource_metadata: unknown }[] }) => s.section_activity_data)
      .map((a: { content_resource_metadata: unknown }) => normalizeActivityResource(a.content_resource_metadata))
      .filter((b: { kind: string }) => b.kind === 'challenge') as ChallengeBlock[];
    expect(blocks.length).toBeGreaterThan(0);

    const failures: string[] = [];
    let instances = 0;
    let placeholdersChecked = 0;
    // Some book code builds the "Ex:" hint with a smaller tolerance than the answer is graded with,
    // so a hint can occasionally fall inside the accepted range. That's the book's behavior; just bound it.
    const acceptedPlaceholders: string[] = [];
    for (const block of blocks) {
      block.levels.forEach((level, li) => {
        for (let seed = 1; seed <= 6; seed++) {
          const where = `${block.caption.slice(0, 50)} / ${level.name} / seed ${seed}`;
          const r = runner.run(block.sharedCode, level.code, seed);
          if (!r.ok) {
            failures.push(`${where}: ${r.error}`);
            continue;
          }
          const p = instantiateLevel(block, li, r.vars);
          instances++;
          if (p.missing.length) failures.push(`${where}: missing ${p.missing.join(', ')}`);
          if (!p.solutionHtml) failures.push(`${where}: no solution`);
          const inputs = p.parts.filter((x) => x.kind === 'input' || x.kind === 'dropdown');
          if (inputs.length === 0) failures.push(`${where}: no inputs`);
          for (const part of inputs) {
            const spec = part.answer;
            if (spec.kind === 'numeric') {
              const a = spec.answers[0] ?? '';
              if (parseNumber(a) === null) failures.push(`${where}: answer "${a}" is not a number`);
              else if (!checkAnswer(a, spec)) failures.push(`${where}: answer "${a}" fails its own check`);
              const ex = part.kind === 'input' ? /Ex:\s*(\S+)/.exec(part.placeholder ?? '')?.[1] : undefined;
              if (ex && parseNumber(ex) !== null && spec.tolerance.value > 0) {
                placeholdersChecked++;
                if (checkAnswer(ex, spec)) acceptedPlaceholders.push(`${where}: "${ex}"`);
              }
            } else if (spec.kind === 'choice' && part.kind === 'dropdown' && !part.options.includes(spec.correct)) {
              failures.push(`${where}: correct option "${spec.correct}" not among options`);
            }
          }
        }
      });
    }
    console.log(`challenge instances generated: ${instances}, placeholders checked: ${placeholdersChecked}`);
    if (acceptedPlaceholders.length) console.log('hints inside the accepted range:', acceptedPlaceholders);
    expect(failures).toEqual([]);
    expect(acceptedPlaceholders.length).toBeLessThanOrEqual(Math.ceil(placeholdersChecked * 0.02));
  });
});
