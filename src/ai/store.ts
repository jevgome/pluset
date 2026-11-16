// Generated problems, stored locally per book and section so they can be
// practiced again without paying to regenerate them.

import type { AiProblem, ProblemReview } from './schema';

export interface StoredAiProblem {
  id: string;
  book: string;
  /** Section label, e.g. "8.5". */
  section: string;
  problem: AiProblem;
  createdAt: string;
  generatorModel: string;
  reviewerModel: string;
  review: ProblemReview | null;
}

type BookStore = Record<string, StoredAiProblem[]>;

const key = (book: string) => `ai:problems:${book}`;

async function loadBook(book: string): Promise<BookStore> {
  const got = await chrome.storage.local.get(key(book));
  return (got[key(book)] as BookStore | undefined) ?? {};
}

export async function listAiProblems(book: string, sections?: string[]): Promise<StoredAiProblem[]> {
  const store = await loadBook(book);
  const labels = sections ?? Object.keys(store);
  return labels.flatMap((s) => store[s] ?? []);
}

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn);
  chain = next.catch(() => {});
  return next;
}

export function addAiProblems(book: string, problems: StoredAiProblem[]): Promise<void> {
  return serialized(async () => {
    const store = await loadBook(book);
    for (const p of problems) (store[p.section] ??= []).push(p);
    await chrome.storage.local.set({ [key(book)]: store });
  });
}

export function deleteAiProblem(book: string, section: string, id: string): Promise<void> {
  return serialized(async () => {
    const store = await loadBook(book);
    store[section] = (store[section] ?? []).filter((p) => p.id !== id);
    await chrome.storage.local.set({ [key(book)]: store });
  });
}

export const newProblemId = () => crypto.randomUUID();
