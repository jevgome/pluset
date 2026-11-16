// Main-thread interface to the Python worker.
// Loading Python and running a problem's code are timed separately: loading can be
// slow on some machines (it reads ~12 MB), but generator code should finish in moments.

import type { LevelVars, MatchRequest, MatchResult } from './runtime';
import type { WorkerMessage, WorkerRequest } from './worker';

const LOAD_TIMEOUT_MS = 180_000;
const RUN_TIMEOUT_MS = 15_000;
/** Matching runs the generator many times; zymatch.py stops itself at the request's budget. */
const MATCH_TIMEOUT_MS = 60_000;

type Progress = (stage: string) => void;

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void; timer: number }>();
const progressListeners = new Set<Progress>();
let lastStage = '';

function send(w: Worker, m: WorkerRequest) {
  w.postMessage(m);
}

function resetWorker(error: Error) {
  worker?.terminate();
  worker = null;
  ready = null;
  lastStage = '';
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(error);
  }
  pending.clear();
}

/** Starts the worker and loads Python. Resolves when ready; rejects with a specific reason. */
function ensureReady(): Promise<void> {
  if (ready) return ready;
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker = w;

  ready = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      const where = lastStage ? ` (stuck at: ${lastStage})` : '';
      const err = new Error(`Python didn't finish loading within ${LOAD_TIMEOUT_MS / 1000} s${where}.`);
      resetWorker(err);
      reject(err);
    }, LOAD_TIMEOUT_MS);

    w.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const m = event.data;
      switch (m.type) {
        case 'progress':
          lastStage = m.stage;
          for (const l of progressListeners) l(m.stage);
          break;
        case 'ready':
          clearTimeout(timer);
          console.info(`[Pluset] Python ready in ${m.ms} ms`);
          resolve();
          break;
        case 'initError': {
          clearTimeout(timer);
          const err = new Error(`Python failed to load: ${m.error}`);
          resetWorker(err);
          reject(err);
          break;
        }
        case 'result': {
          const p = pending.get(m.id);
          if (!p) return;
          pending.delete(m.id);
          clearTimeout(p.timer);
          if (m.result.ok) p.resolve(m.result.vars as never);
          else p.reject(new Error(m.result.error));
          break;
        }
        case 'matched': {
          const p = pending.get(m.id);
          if (!p) return;
          pending.delete(m.id);
          clearTimeout(p.timer);
          p.resolve(m.result as never);
          break;
        }
      }
    };
    w.onerror = (event) => {
      event.preventDefault();
      clearTimeout(timer);
      const detail = [event.message, event.filename && `${event.filename}:${event.lineno}`].filter(Boolean).join(' at ');
      const err = new Error(`The Python worker crashed${detail ? `: ${detail}` : ''}.`);
      resetWorker(err);
      reject(err);
    };
  });
  send(w, { type: 'init' });
  return ready;
}

/** Runs one challenge level's generator code and returns its variables. */
export async function runLevel(sharedCode: string, levelCode: string, seed: number, onProgress?: Progress): Promise<LevelVars> {
  if (onProgress) {
    progressListeners.add(onProgress);
    if (lastStage && !ready) onProgress(lastStage);
  }
  try {
    await ensureReady();
  } finally {
    if (onProgress) progressListeners.delete(onProgress);
  }
  const w = worker;
  if (!w) throw new Error('The Python worker stopped unexpectedly.');
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => resetWorker(new Error('This problem’s generator code took too long and was stopped.')),
      RUN_TIMEOUT_MS,
    );
    pending.set(id, { resolve, reject, timer });
    send(w, { type: 'run', id, sharedCode, levelCode, seed });
  });
}

/** Searches for the random choices that reproduce the values a student's page shows. */
export async function matchLevel(request: MatchRequest): Promise<MatchResult> {
  await ensureReady();
  const w = worker;
  if (!w) throw new Error('The Python worker stopped unexpectedly.');
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => resetWorker(new Error('Recreating your version took too long and was stopped.')),
      MATCH_TIMEOUT_MS,
    );
    pending.set(id, { resolve, reject, timer });
    send(w, { type: 'match', id, request });
  });
}

export const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now();
