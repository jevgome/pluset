// Live end-to-end check of the Claude Code provider: runs the real generation pipeline
// through a running Pluset helper. Uses your Claude plan's usage, so it only runs when
// asked:   PLUSET_LIVE=1 npx vitest run tests/live-claude-code.test.ts
// (start the helper first with `npm run helper`).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadPyodide } from 'pyodide';
import { describe, expect, it } from 'vitest';
import { claudeCodeProvider, DEFAULT_HELPER_URL } from '../src/ai/claudeCode';
import { generateProblems } from '../src/ai/generate';
import { DEFAULT_SETTINGS } from '../src/ai/settings';
import { normalizeSectionResponse } from '../src/core/normalize';
import { instantiateLevel } from '../src/engine/instantiate';
import { createLevelRunner } from '../src/engine/runtime';

const root = fileURLToPath(new URL('..', import.meta.url));
const samplePath = [`${root}samples/5.json`, `${root}5.json`].find(existsSync);
const tokenFile = `${homedir()}/.config/pluset/helper-token`;

describe.skipIf(!process.env.PLUSET_LIVE || !samplePath || !existsSync(tokenFile))('live: Claude Code provider', () => {
  it('generates, validates and reviews real problems', { timeout: 20 * 60_000 }, async () => {
    const section = normalizeSectionResponse(JSON.parse(readFileSync(samplePath!, 'utf8')), 'BOOK');
    const runner = createLevelRunner(await loadPyodide());
    const prelude = 'from zyversions import zyv_sig_fig_round, convert_to_scinot, build_placeholder';
    const provider = claudeCodeProvider({ url: DEFAULT_HELPER_URL, token: readFileSync(tokenFile, 'utf8').trim() });

    const res = await generateProblems({
      book: 'BOOK',
      sections: [section],
      count: Number(process.env.PLUSET_LIVE_COUNT ?? 3),
      existing: [],
      settings: { ...DEFAULT_SETTINGS, provider: 'claude-code' },
      provider,
      runCode: async (code, seed) => {
        const r = runner.run(prelude, code, seed);
        if (!r.ok) throw new Error(r.error);
        return r.vars;
      },
      example: async (block, level) => {
        const r = runner.run(block.sharedCode, block.levels[level]!.code, 1);
        return r.ok ? instantiateLevel(block, level, r.vars) : null;
      },
      onProgress: (m) => console.log(`  … ${m}`),
    });

    if (process.env.PLUSET_LIVE_OUT) writeFileSync(process.env.PLUSET_LIVE_OUT, JSON.stringify(res, null, 2));
    console.log(`kept ${res.kept.length}, rejected ${res.rejected.length}`);
    for (const r of res.rejected) console.log(`  rejected: ${r.problem.prompt.slice(0, 80)} -> ${r.reasons.join('; ')}`);
    console.log('usage', JSON.stringify(res.usage));
    expect(res.kept.length + res.rejected.length).toBeGreaterThan(0);
  });
});
