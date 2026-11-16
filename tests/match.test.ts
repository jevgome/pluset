import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPyodide } from 'pyodide';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ChallengeBlock } from '../src/core/model';
import { normalizeActivityResource } from '../src/core/normalize';
import { fillTemplate, instantiateLevel } from '../src/engine/instantiate';
import { matchInput } from '../src/engine/match';
import { solvedLevels } from '../src/explain/solve';
import { createLevelRunner, type LevelRunner, type LevelVars } from '../src/engine/runtime';

const root = fileURLToPath(new URL('..', import.meta.url));
const samplePath = [`${root}samples/activity_data.json`, `${root}activity_data.json`].find(existsSync);

/** What a student's page would show for a level: its text with their values, in any element order. */
function pageFor(block: ChallengeBlock, levelIndex: number, vars: LevelVars, mathAsText: boolean): string {
  const missing = new Set<string>();
  const texts = (block.levels[levelIndex]!.questions[0]?.elements ?? [])
    .filter((e) => e.type === 'text' && e.text && e.text !== 'add text')
    .map((e) => fillTemplate(e.text!, vars, missing))
    .reverse();
  const body = texts.join('\n');
  // Rendered math loses the TeX commands but keeps the numbers.
  return `CHALLENGE ACTIVITY 6.8.1: ${block.caption} 1 2 3 Check Next level\n${mathAsText ? body.replace(/\\[a-zA-Z]+|[{}^_~]/g, ' ') : body}`;
}

const answersOf = (block: ChallengeBlock, levelIndex: number, vars: LevelVars) =>
  instantiateLevel(block, levelIndex, vars)
    .parts.map((p) => (p.kind === 'input' ? p.answer.kind === 'numeric' && p.answer.answers.join('|') : p.kind === 'dropdown' ? p.answer.kind === 'choice' && p.answer.correct : null))
    .filter((a) => a !== null);

describe.skipIf(!samplePath)('recreating a student’s version from the page', { timeout: 600_000 }, () => {
  let runner: LevelRunner;
  beforeAll(async () => {
    runner = createLevelRunner(await loadPyodide());
  }, 120_000);

  const loadBlocks = () =>
    JSON.parse(readFileSync(samplePath!, 'utf8'))
      .activity_data.flatMap((s: { section_activity_data: unknown[] }) => s.section_activity_data)
      .map((a: { content_resource_metadata: unknown }) => normalizeActivityResource(a.content_resource_metadata))
      .filter((b: { kind: string }) => b.kind === 'challenge') as ChallengeBlock[];

  const solve = (block: ChallengeBlock, page: string) => {
    const requests = block.levels.map((_, i) => matchInput(block, i, page));
    return solvedLevels(block, requests, requests.map((r) => runner.match(r)));
  };

  it('picks the level the page shows and lists its values and answers', () => {
    const block = loadBlocks().find((b) => b.levels.length === 4 && b.caption.includes('storm sewer'))!;
    const truth = runner.run(block.sharedCode, block.levels[2]!.code, 5);
    if (!truth.ok) throw new Error(truth.error);
    const res = solve(block, pageFor(block, 2, truth.vars, true));
    if (!res.ok) throw new Error(res.error);
    expect(res.levels.map((l) => l.name)).toEqual(['Level 3']);
    const level = res.levels[0]!;
    expect(level.exact).toBe(true);
    expect(level.shown).toContainEqual(['Re_coef_display', truth.vars.Re_coef_display]);
    expect(level.answers).toHaveLength(1);
    expect(Number(level.answers[0]!.value)).toBeCloseTo(Number(truth.vars.f), 4);
    expect(level.solution).toContain(String(truth.vars.f_display));
  });

  it('refuses a page that belongs to another activity', () => {
    const [a, b] = loadBlocks();
    const truth = runner.run(b!.sharedCode, b!.levels[0]!.code, 3);
    if (!truth.ok) throw new Error(truth.error);
    const res = solve(a!, pageFor(b!, 0, truth.vars, false));
    expect(res.ok).toBe(false);
  });

  it('finds the values behind every captured challenge level', () => {
    const blocks = loadBlocks();

    const failures: string[] = [];
    let tried = 0;
    let confidentlyWrong = 0;
    for (const block of blocks) {
      block.levels.forEach((_, li) => {
        for (const [seed, mathAsText] of [[11, false], [23, true], [37, true], [41, false], [59, true]] as const) {
          const truth = runner.run(block.sharedCode, block.levels[li]!.code, seed);
          if (!truth.ok) return;
          tried++;
          const res = runner.match(matchInput(block, li, pageFor(block, li, truth.vars, mathAsText)));
          const where = `${block.caption.slice(0, 50)} L${li + 1} seed ${seed}`;
          if (!res.ok) failures.push(`${where}: ${res.error}`);
          else if (JSON.stringify(answersOf(block, li, res.vars)) !== JSON.stringify(answersOf(block, li, truth.vars))) {
            failures.push(`${where}: wrong answers (score ${res.score}/${res.size}, ambiguous ${res.ambiguous}, ${res.runs} runs)`);
            // A wrong version is acceptable only when the search says the page doesn't pin it down.
            if (!res.ambiguous) confidentlyWrong++;
          }
        }
      });
    }
    console.log(`matched ${tried - failures.length}/${tried}\n${failures.join('\n')}`);
    expect(confidentlyWrong).toBe(0);
    expect(failures.length).toBeLessThanOrEqual(Math.floor(tried * 0.05));
  });
});
