import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPyodide } from 'pyodide';
import { describe, expect, it } from 'vitest';
import { buildBookContext, estimateTokens } from '../src/ai/context';
import { normalizeSectionResponse } from '../src/core/normalize';
import { instantiateLevel } from '../src/engine/instantiate';
import { createLevelRunner } from '../src/engine/runtime';

const root = fileURLToPath(new URL('..', import.meta.url));
const samplePath = [`${root}samples/5.json`, `${root}5.json`].find(existsSync);

describe.skipIf(!samplePath)('buildBookContext (real section)', { timeout: 120_000 }, () => {
  it('produces compact text with activities, figures and challenge instances', async () => {
    const section = normalizeSectionResponse(JSON.parse(readFileSync(samplePath!, 'utf8')), 'BOOK');
    const runner = createLevelRunner(await loadPyodide());
    const ctx = await buildBookContext([section], async (block, level) => {
      const r = runner.run(block.sharedCode, block.levels[level]!.code, 1);
      return r.ok ? instantiateLevel(block, level, r.vars) : null;
    });

    if (process.env.DUMP_CONTEXT) writeFileSync(process.env.DUMP_CONTEXT, ctx.text);
    console.log(`context: ${ctx.text.length} chars ≈ ${estimateTokens(ctx.text)} tokens, ${ctx.images.length} images`);

    expect(ctx.sections).toEqual(['8.5']);
    expect(ctx.text).toContain('===== SECTION 8.5: Minor pipe flow losses');
    expect(ctx.text).toContain('[Participation activity (multiple choice): Minor losses in pipe systems.]');
    expect(ctx.text).toContain('[correct]');
    expect(ctx.text).toContain('Level 4 of 4 (one randomized instance)');
    expect(ctx.text).toContain('Worked solution:');
    expect(ctx.text).not.toMatch(/<\/?(math|mi|mrow|p|div)\b/); // no leftover markup
    expect(ctx.text).not.toContain('${'); // all challenge templates filled
    expect(ctx.images.length).toBeGreaterThan(5);
    expect(ctx.images[0]?.label).toMatch(/^Figure 8\.5\.\d/);
  });
});
