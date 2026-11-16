// Sets up a Pyodide instance with the zyBooks stand-in modules and exposes a
// function that runs one challenge level. Shared by the web worker and the tests.

import type { PyodideAPI } from 'pyodide';
import eqatSource from './python/eqat.py?raw';
import runnerSource from './python/zyrunner.py?raw';
import zyversionsSource from './python/zyversions.py?raw';

export type LevelVars = Record<string, string | string[]>;

export type RunResult = { ok: true; vars: LevelVars } | { ok: false; error: string };

export interface LevelRunner {
  run(sharedCode: string, levelCode: string, seed: number): RunResult;
}

export function createLevelRunner(py: PyodideAPI): LevelRunner {
  py.setStdout({ batched: () => {} }); // challenge code sometimes prints; ignore it
  py.setStderr({ batched: () => {} });
  py.FS.mkdirTree('/zy');
  py.FS.writeFile('/zy/zyversions.py', zyversionsSource);
  py.FS.writeFile('/zy/eqat.py', eqatSource);
  py.FS.writeFile('/zy/zyrunner.py', runnerSource);
  py.runPython("import sys\nif '/zy' not in sys.path: sys.path.insert(0, '/zy')\nimport zyrunner");
  const runFn = py.globals.get('zyrunner').run as (a: string, b: string, c: number) => string;

  return {
    run(sharedCode, levelCode, seed) {
      return JSON.parse(runFn(sharedCode, levelCode, seed)) as RunResult;
    },
  };
}
