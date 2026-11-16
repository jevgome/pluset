// Web worker that owns the Python runtime. Keeping it off the main thread keeps
// the page responsive, and lets the client kill runaway code by terminating us.

import { loadPyodide } from 'pyodide';
import { createLevelRunner, type LevelRunner, type MatchRequest, type MatchResult, type RunResult } from './runtime';

export type WorkerRequest =
  | { type: 'init' }
  | { type: 'run'; id: number; sharedCode: string; levelCode: string; seed: number }
  | { type: 'match'; id: number; request: MatchRequest };

export type WorkerMessage =
  | { type: 'progress'; stage: string }
  | { type: 'ready'; ms: number }
  | { type: 'initError'; error: string }
  | { type: 'result'; id: number; result: RunResult }
  | { type: 'matched'; id: number; result: MatchResult };

const post = (m: WorkerMessage) => self.postMessage(m);

let runner: Promise<LevelRunner> | null = null;

function getRunner(): Promise<LevelRunner> {
  if (runner) return runner;
  const started = performance.now();
  // The Pyodide runtime files are copied to /pyodide/ at build time.
  const indexURL = new URL('/pyodide/', self.location.href).href;
  post({ type: 'progress', stage: 'Loading Python (about 12 MB, first time only)…' });
  runner = loadPyodide({ indexURL })
    .then((py) => {
      post({ type: 'progress', stage: 'Starting Python…' });
      const r = createLevelRunner(py);
      post({ type: 'ready', ms: Math.round(performance.now() - started) });
      return r;
    })
    .catch((e: unknown) => {
      runner = null; // allow a retry
      const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      post({ type: 'initError', error });
      throw e;
    });
  return runner;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    await getRunner().catch(() => {});
    return;
  }
  const error = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) });
  if (msg.type === 'match') {
    let result: MatchResult;
    try {
      result = (await getRunner()).match(msg.request);
    } catch (e) {
      result = error(e);
    }
    post({ type: 'matched', id: msg.id, result });
    return;
  }
  let result: RunResult;
  try {
    result = (await getRunner()).run(msg.sharedCode, msg.levelCode, msg.seed);
  } catch (e) {
    result = error(e);
  }
  post({ type: 'result', id: msg.id, result });
};
