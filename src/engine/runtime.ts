// Sets up a Pyodide instance with the zyBooks stand-in modules and exposes a
// function that runs one challenge level. Shared by the web worker and the tests.

import type { PyodideAPI } from 'pyodide';
import eqatSource from './python/eqat.py?raw';
import matchSource from './python/zymatch.py?raw';
import runnerSource from './python/zyrunner.py?raw';
import zyversionsSource from './python/zyversions.py?raw';

export type LevelVars = Record<string, string | string[]>;

export type RunResult = { ok: true; vars: LevelVars } | { ok: false; error: string };

export type MatchResult =
  | { ok: true; vars: LevelVars; score: number; size: number; points: number; ambiguous: boolean; runs: number }
  | { ok: false; error: string };

export interface MatchRequest {
  sharedCode: string;
  levelCode: string;
  /** Text templates of the level (with ${var} placeholders) to find on the page. */
  templates: string[];
  /** Answer templates, used to tell whether other matching versions would change the answers. */
  answerTemplates: string[];
  pageText: string;
  budgetMs: number;
}

export interface LevelRunner {
  run(sharedCode: string, levelCode: string, seed: number): RunResult;
  /** Searches for the random choices that reproduce the values shown on the page (see zymatch.py). */
  match(req: MatchRequest): MatchResult;
}

export function createLevelRunner(py: PyodideAPI): LevelRunner {
  py.setStdout({ batched: () => {} }); // challenge code sometimes prints; ignore it
  py.setStderr({ batched: () => {} });
  py.FS.mkdirTree('/zy');
  py.FS.writeFile('/zy/zyversions.py', zyversionsSource);
  py.FS.writeFile('/zy/eqat.py', eqatSource);
  py.FS.writeFile('/zy/zyrunner.py', runnerSource);
  py.FS.writeFile('/zy/zymatch.py', matchSource);
  py.runPython("import sys\nif '/zy' not in sys.path: sys.path.insert(0, '/zy')\nimport zyrunner, zymatch");
  const runFn = py.globals.get('zyrunner').run as (a: string, b: string, c: number) => string;
  const matchFn = py.globals.get('zymatch').match as (a: string, b: string, c: string, d: string, e: string, f: number) => string;

  return {
    run(sharedCode, levelCode, seed) {
      return JSON.parse(runFn(sharedCode, levelCode, seed)) as RunResult;
    },
    match(r) {
      const out = matchFn(r.sharedCode, r.levelCode, JSON.stringify(r.templates), JSON.stringify(r.answerTemplates), r.pageText, r.budgetMs);
      return JSON.parse(out) as MatchResult;
    },
  };
}
