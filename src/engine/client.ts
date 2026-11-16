// Main-thread interface to the Python worker, with a timeout that kills and
// replaces the worker if a level's code hangs.

import type { LevelVars } from './runtime';
import type { RunRequest, RunResponse } from './worker';

const FIRST_RUN_TIMEOUT_MS = 60_000; // includes downloading/initializing Python
const RUN_TIMEOUT_MS = 10_000;

let worker: Worker | null = null;
let warm = false;
let nextId = 1;
const pending = new Map<number, { resolve: (v: LevelVars) => void; reject: (e: Error) => void; timer: number }>();

function failAll(error: Error) {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(error);
  }
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<RunResponse>) => {
    const { id, result } = event.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    warm = true;
    if (result.ok) p.resolve(result.vars);
    else p.reject(new Error(result.error));
  };
  worker.onerror = (event) => {
    event.preventDefault();
    resetWorker(new Error(`Python worker failed: ${event.message || 'unknown error'}`));
  };
  return worker;
}

function resetWorker(error: Error) {
  worker?.terminate();
  worker = null;
  warm = false;
  failAll(error);
}

/** Runs one challenge level's generator code and returns its variables. */
export function runLevel(sharedCode: string, levelCode: string, seed: number): Promise<LevelVars> {
  const w = getWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => resetWorker(new Error('The problem generator took too long and was stopped.')),
      warm ? RUN_TIMEOUT_MS : FIRST_RUN_TIMEOUT_MS,
    );
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ id, sharedCode, levelCode, seed } satisfies RunRequest);
  });
}

export const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now();
