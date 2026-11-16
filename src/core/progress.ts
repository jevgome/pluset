// Per-problem practice history, stored locally per book, and the ordering logic
// for practice sessions. An "item" is one level of one challenge activity:
// key = "<chapter>.<section>:<content resource id>:<level index>".

export interface ItemStats {
  /** Problem instances the student checked at least once. */
  attempts: number;
  firstTryCorrect: number;
  solved: number;
  solutionsViewed: number;
  /** ms since epoch. */
  lastSeen: number;
}

export type ProgressMap = Record<string, ItemStats>;

export interface OutcomeLike {
  attempted: boolean;
  firstTryCorrect: boolean;
  solved: boolean;
  viewedSolution: boolean;
}

export const itemKey = (chapter: number, section: number, blockId: number, level: number) =>
  `${chapter}.${section}:${blockId}:${level}`;

/** Folds one finished problem into the stats. Unattempted problems don't count. */
export function applyOutcome(prev: ItemStats | undefined, o: OutcomeLike, now: number): ItemStats | undefined {
  if (!o.attempted) return prev;
  const s = prev ?? { attempts: 0, firstTryCorrect: 0, solved: 0, solutionsViewed: 0, lastSeen: 0 };
  return {
    attempts: s.attempts + 1,
    firstTryCorrect: s.firstTryCorrect + (o.firstTryCorrect ? 1 : 0),
    solved: s.solved + (o.solved ? 1 : 0),
    solutionsViewed: s.solutionsViewed + (o.viewedSolution ? 1 : 0),
    lastSeen: now,
  };
}

/**
 * How much an item needs practice, in [0, 1]. Uses the first-try success rate with a
 * prior of one success and one failure, so one lucky try doesn't mark an item mastered.
 * Items never practiced score 0.6: above a 50/50 record, below items that keep going wrong.
 */
export function weakness(s: ItemStats | undefined): number {
  if (!s || s.attempts === 0) return 0.6;
  const successRate = (s.firstTryCorrect + 1) / (s.attempts + 2);
  const solutionPenalty = Math.min(0.1, (s.solutionsViewed / s.attempts) * 0.1);
  return Math.min(1, 1 - successRate + solutionPenalty);
}

export type SessionOrder = 'book' | 'shuffle' | 'weakest';

function shuffle<T>(xs: T[], random: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function orderItems<T extends { key: string }>(
  items: T[],
  progress: ProgressMap,
  order: SessionOrder,
  random: () => number = Math.random,
): T[] {
  if (order === 'book') return [...items];
  const shuffled = shuffle(items, random);
  if (order === 'shuffle') return shuffled;
  // Stable sort of a shuffled list: equal weakness keeps a random order.
  return shuffled.sort((a, b) => weakness(progress[b.key]) - weakness(progress[a.key]));
}

/* ---------- storage ---------- */

const storageKey = (book: string) => `progress:${book}`;

export async function loadProgress(book: string): Promise<ProgressMap> {
  const key = storageKey(book);
  const got = await chrome.storage.local.get(key);
  return (got[key] as ProgressMap | undefined) ?? {};
}

// Serialize writes so quick successive outcomes don't overwrite each other.
let writeChain: Promise<unknown> = Promise.resolve();

export function recordOutcome(book: string, key: string, o: OutcomeLike): Promise<void> {
  if (!o.attempted) return Promise.resolve();
  const write = writeChain.then(async () => {
    const progress = await loadProgress(book);
    const next = applyOutcome(progress[key], o, Date.now());
    if (next) progress[key] = next;
    await chrome.storage.local.set({ [storageKey(book)]: progress });
  });
  writeChain = write.catch(() => {});
  return write;
}

export async function clearProgress(book: string): Promise<void> {
  await chrome.storage.local.remove(storageKey(book));
}
