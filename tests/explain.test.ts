import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Section } from '../src/core/model';
import { normalizeSectionResponse } from '../src/core/normalize';
import { explainItems } from '../src/explain/items';

const rich = (html: string) => ({ html, images: [] });

const section: Section = {
  book: 'BOOK',
  chapter: 3,
  section: 2,
  title: 'Made-up section',
  subject: null,
  blocks: [
    { kind: 'text', id: 1, caption: '', activityType: null, body: rich('<p>Reading.</p>') },
    { kind: 'animation', id: 2, caption: 'An animation', activityType: 'participation', description: 'Step 1.' },
    {
      kind: 'multipleChoice',
      id: 3,
      caption: 'Colors',
      activityType: 'participation',
      questions: [
        {
          prompt: rich('<p>Which is warm?</p>'),
          choices: [
            { label: rich('Blue'), correct: false, explanation: rich('Cool.') },
            { label: rich('Red'), correct: true, explanation: rich('Red is warm.') },
          ],
        },
      ],
    },
    {
      kind: 'shortAnswer',
      id: 4,
      caption: 'Numbers',
      activityType: 'participation',
      questions: [
        { prompt: rich('2 + 2 = '), answers: ['4', 'four'], preferred: '4', hint: null, textAfter: null, explanation: rich('Add them.'), caseSensitive: false },
        { prompt: rich('\\(x^2\\) at x = 3 is'), answers: ['9'], preferred: null, hint: null, textAfter: null, explanation: rich(''), caseSensitive: false },
      ],
    },
    { kind: 'challenge', id: 5, caption: 'Compute', activityType: 'challenge', tool: 'ProgressionPlayer', sharedCode: '', levels: [] },
  ],
};

describe('explainItems', () => {
  const items = explainItems(section);

  it('lists one entry per question, numbered like the page', () => {
    expect(items.map((i) => [i.key, i.number, i.activityIndex])).toEqual([
      ['3:0', '3.2.2', 1], // the animation is participation 3.2.1 and activity 0
      ['4:0', '3.2.3', 2],
      ['4:1', '3.2.3', 2],
    ]);
  });

  it('carries the book’s answers and explanations', () => {
    expect(items[0]).toMatchObject({ bookAnswer: 'Red', bookExplanation: 'Red is warm.' });
    expect(items[1]).toMatchObject({ bookAnswer: '4 (also accepted: four)', bookExplanation: 'Add them.' });
    expect(items[2]).toMatchObject({ bookAnswer: '9', bookExplanation: null });
  });

  it('skips challenge activities, which have no fixed answer', () => {
    expect(items.some((i) => i.blockId === 5)).toBe(false);
  });
});

const root = fileURLToPath(new URL('..', import.meta.url));
const samplePath = [`${root}samples/5.json`, `${root}5.json`].find(existsSync);

describe.skipIf(!samplePath)('explainItems (real section)', () => {
  it('finds questions and answers', () => {
    const items = explainItems(normalizeSectionResponse(JSON.parse(readFileSync(samplePath!, 'utf8')), 'BOOK'));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.bookAnswer)).toBe(true);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });
});
