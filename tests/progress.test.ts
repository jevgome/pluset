import { describe, expect, it } from 'vitest';
import { applyOutcome, itemKey, orderItems, weakness, type ItemStats } from '../src/core/progress';

const outcome = (o: Partial<{ attempted: boolean; firstTryCorrect: boolean; solved: boolean; viewedSolution: boolean }>) => ({
  attempted: true,
  firstTryCorrect: false,
  solved: false,
  viewedSolution: false,
  ...o,
});

const stats = (attempts: number, firstTryCorrect: number, solutionsViewed = 0): ItemStats => ({
  attempts,
  firstTryCorrect,
  solved: firstTryCorrect,
  solutionsViewed,
  lastSeen: 0,
});

/** Deterministic pseudo-random numbers for tests. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

describe('applyOutcome', () => {
  it('ignores problems that were never checked', () => {
    expect(applyOutcome(undefined, outcome({ attempted: false }), 5)).toBeUndefined();
  });

  it('accumulates attempts, first-try successes, solves and solution views', () => {
    let s = applyOutcome(undefined, outcome({ firstTryCorrect: true, solved: true }), 1);
    s = applyOutcome(s, outcome({ solved: true, viewedSolution: true }), 2);
    expect(s).toEqual({ attempts: 2, firstTryCorrect: 1, solved: 2, solutionsViewed: 1, lastSeen: 2 });
  });
});

describe('weakness', () => {
  it('ranks repeated failures above unseen items above mastered items', () => {
    const failing = weakness(stats(3, 0));
    const unseen = weakness(undefined);
    const mastered = weakness(stats(4, 4));
    expect(failing).toBeGreaterThan(unseen);
    expect(unseen).toBeGreaterThan(mastered);
  });

  it('does not treat one lucky try as mastery', () => {
    expect(weakness(stats(1, 1))).toBeGreaterThan(weakness(stats(5, 5)));
  });

  it('adds a small penalty for relying on solutions', () => {
    expect(weakness(stats(2, 1, 2))).toBeGreaterThan(weakness(stats(2, 1, 0)));
  });
});

describe('orderItems', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map((key) => ({ key }));

  it('keeps book order', () => {
    expect(orderItems(items, {}, 'book').map((i) => i.key)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('shuffles without losing items', () => {
    const out = orderItems(items, {}, 'shuffle', rng(3)).map((i) => i.key);
    expect([...out].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(out).not.toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('puts the weakest items first', () => {
    const progress = { c: stats(4, 0), a: stats(5, 5), e: stats(2, 1) };
    const out = orderItems(items, progress, 'weakest', rng(7)).map((i) => i.key);
    expect(out[0]).toBe('c');
    expect(out.at(-1)).toBe('a');
  });
});

describe('itemKey', () => {
  it('identifies one level of one activity', () => {
    expect(itemKey(8, 5, 130936836, 2)).toBe('8.5:130936836:2');
  });
});
