// Web worker that owns the Python runtime. Keeping it off the main thread keeps
// the page responsive, and lets the client kill runaway code by terminating us.

import { loadPyodide } from 'pyodide';
import { createLevelRunner, type LevelRunner, type RunResult } from './runtime';

export interface RunRequest {
  id: number;
  sharedCode: string;
  levelCode: string;
  seed: number;
}

export interface RunResponse {
  id: number;
  result: RunResult;
}

let runner: Promise<LevelRunner> | null = null;

function getRunner(): Promise<LevelRunner> {
  runner ??= loadPyodide({
    // The Pyodide runtime files are copied to /pyodide/ at build time.
    indexURL: new URL('/pyodide/', self.location.href).href,
  }).then(createLevelRunner);
  return runner;
}

self.onmessage = async (event: MessageEvent<RunRequest>) => {
  const { id, sharedCode, levelCode, seed } = event.data;
  let result: RunResult;
  try {
    result = (await getRunner()).run(sharedCode, levelCode, seed);
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  self.postMessage({ id, result } satisfies RunResponse);
};
