import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Block, ChallengeBlock, ContainerBlock, MultipleChoiceBlock, TextBlock } from '../src/core/model';
import { assignRows, normalizeActivityResource, normalizeSectionResponse, zyImageUrl } from '../src/core/normalize';

const html = (text: string) => [{ text, attributes: [{ type: 'html' }] }];

/** A tiny hand-made response in the zyBooks section format. */
const fixture = {
  success: true,
  section: {
    canonical_chapter_number: 8,
    canonical_section_number: 5,
    release_id: 5,
    title: 'Minor losses',
    custom_title: null,
    content_resources: [
      {
        id: 1,
        type: 'html',
        caption: null,
        activity_type: null,
        payload: {
          subject: 'Some_Subject',
          html: [
            ...html('<p>See </p>'),
            { guid: 'g', text: '', reference: 'eq-a', attributes: [{ type: 'reference' }] },
            ...html(' and Fig. '),
            { guid: 'g2', text: '', reference: 'fig-ref', attributes: [{ type: 'reference' }] },
            ...html(' and Eq. '),
            { guid: 'g3', text: '', reference: 'elsewhere', attributes: [{ type: 'reference' }] },
            { ref: 'eq-a', enumid: 'eq-a', text: '$$h_L = K_L V^2/2g$$', attributes: [{ type: 'inline-enum' }] },
          ],
        },
      },
      {
        id: 2,
        type: 'container',
        caption: 'A figure.',
        activity_type: null,
        payload: {
          name: 'Figure',
          ref: 'fig-ref',
          subject: 'Some_Subject',
          html: [{ text: null, attributes: [{ type: 'image', alt_text: 'A valve "open"', filename: 'img-1', image_ids: ['img-1'], width: '300' }] }],
        },
      },
      {
        id: 3,
        type: 'multiple_choice',
        caption: 'Losses.',
        activity_type: 'participation',
        payload: {
          questions: [
            {
              text: html('Which?'),
              choices: [
                { label: html('A'), correct: false, explanation: html('No') },
                { label: html('B'), correct: true, explanation: html('Yes') },
              ],
            },
          ],
        },
      },
      {
        id: 4,
        type: 'custom',
        caption: 'Challenge.',
        activity_type: 'challenge',
        payload: {
          tool: 'ProgressionPlayerInteractiveAndAccessible',
          options: {
            progression: {
              code: 'g = 32',
              elements: [
                { id: '1', type: 'text', text: 'base text', style: { top: '50px', left: '0px' } },
                { id: '2', type: 'shortanswer', correctAnswers: ['${x}'], style: { top: '10px', left: '0px' } },
                { id: '3', type: 'text', text: 'unused', style: { top: '0px' } },
              ],
              levels: [
                {
                  name: 'Level 1',
                  code: 'x = 1',
                  explanation: '${explanation}',
                  usedElements: ['1', '2'],
                  questions: [{ name: 'Question a', elementVariants: [{ id: '1', text: 'override ${x}' }] }],
                },
              ],
            },
          },
        },
      },
      { id: 5, type: 'mystery', caption: null, activity_type: null, payload: { tool: 'zyNew' } },
    ],
  },
};

describe('normalizeSectionResponse (fixture)', () => {
  const s = normalizeSectionResponse(fixture, 'BOOK');

  it('reads section metadata', () => {
    expect(s).toMatchObject({ book: 'BOOK', chapter: 8, section: 5, title: 'Minor losses', subject: 'Some_Subject' });
    expect(s.blocks.map((b) => b.kind)).toEqual(['text', 'container', 'multipleChoice', 'challenge', 'unknown']);
  });

  it('labels equations and figures and resolves forward references', () => {
    const text = s.blocks[0] as TextBlock;
    expect(text.body.html).toContain('<a class="zy-ref" href="#ref-eq-a">(1)</a>');
    expect(text.body.html).toContain('<span class="zy-eq-num">(1)</span>');
    expect(text.body.html).toContain('<a class="zy-ref" href="#ref-fig-ref">8.5.1</a>');
    expect(text.body.html).toContain('[in another section]');
    expect(s.blocks[1]).toMatchObject({ label: '8.5.1', anchor: 'ref-fig-ref' });
  });

  it('resolves image URLs and escapes alt text', () => {
    const fig = s.blocks[1] as ContainerBlock;
    expect(fig.variant).toBe('Figure');
    expect(fig.body.images).toEqual([{ id: 'img-1', url: zyImageUrl('Some_Subject', 5, 'img-1'), alt: 'A valve "open"' }]);
    expect(fig.body.html).toContain('alt="A valve &quot;open&quot;"');
    expect(zyImageUrl('Some_Subject', 5, 'img-1')).toBe('https://zytools.zybooks.com/zyAuthor/Some_Subject/5/IMAGES/img-1');
  });

  it('keeps multiple-choice answers for later generation', () => {
    const mc = s.blocks[2] as MultipleChoiceBlock;
    expect(mc.questions[0]?.choices.map((c) => c.correct)).toEqual([false, true]);
  });

  it('merges challenge element variants, filters to used elements and sorts by position', () => {
    const ch = s.blocks[3] as ChallengeBlock;
    expect(ch.sharedCode).toBe('g = 32');
    const els = ch.levels[0]?.questions[0]?.elements ?? [];
    expect(els.map((e) => [e.id, e.type, e.text])).toEqual([
      ['2', 'shortanswer', null],
      ['1', 'text', 'override ${x}'],
    ]);
    expect(els[0]?.correctAnswers).toEqual(['${x}']);
  });

  it('rejects responses that are not sections', () => {
    expect(() => normalizeSectionResponse({ success: false }, 'B')).toThrow();
    expect(() => normalizeSectionResponse({ success: true, activity_data: [] }, 'B')).toThrow();
  });
});

// Real captured responses are gitignored (copyrighted content). These tests run only when they exist locally.
const root = fileURLToPath(new URL('..', import.meta.url));
const sample = (name: string) => [`${root}samples/${name}`, `${root}${name}`].find(existsSync);
const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

const sectionSample = sample('5.json');
describe.skipIf(!sectionSample)('real section sample', () => {
  it('normalizes every resource without unknown blocks', () => {
    const s = normalizeSectionResponse(load(sectionSample!), 'BOOK');
    expect(s.chapter).toBe(8);
    expect(s.section).toBe(5);
    expect(s.blocks.length).toBeGreaterThan(10);
    expect(s.blocks.filter((b) => b.kind === 'unknown')).toEqual([]);
    const allHtml = s.blocks.flatMap((b) => ('body' in b ? [b.body.html] : [])).join('');
    const resolved = allHtml.match(/class="zy-ref"/g)?.length ?? 0;
    const external = allHtml.match(/zy-ref--external/g)?.length ?? 0;
    expect(resolved).toBeGreaterThan(external); // most references point inside the section
    const figures = s.blocks.filter((b) => b.kind === 'container' && b.variant === 'Figure');
    expect(figures.every((f) => f.kind === 'container' && f.label?.startsWith('8.5.'))).toBe(true);
    const images = s.blocks.flatMap((b) => ('body' in b ? b.body.images : []));
    expect(images.length).toBeGreaterThan(0);
    expect(images.every((i) => i.url?.startsWith('https://zytools.zybooks.com/zyAuthor/'))).toBe(true);
  });
});

for (const [name, expectedKinds] of [
  ['activity_data.json', ['challenge']],
  ['participation_data.json', ['multipleChoice', 'shortAnswer', 'animation', 'definitionMatch']],
] as const) {
  const path = sample(name);
  describe.skipIf(!path)(`real ${name}`, () => {
    it('normalizes every activity into a known kind', () => {
      const data = load(path!);
      const blocks: Block[] = data.activity_data.flatMap((s: { section_activity_data: { content_resource_metadata: unknown }[] }) =>
        s.section_activity_data.map((a) => normalizeActivityResource(a.content_resource_metadata)),
      );
      expect(blocks.length).toBeGreaterThan(0);
      for (const b of blocks) expect(expectedKinds as readonly string[]).toContain(b.kind);
      for (const b of blocks) {
        if (b.kind !== 'challenge') continue;
        expect(b.levels.length).toBeGreaterThan(0);
        for (const level of b.levels) {
          expect(level.code.length).toBeGreaterThan(0);
          const els = level.questions.flatMap((q) => q.elements);
          expect(els.some((e) => e.type === 'shortanswer' || e.type === 'dropdown')).toBe(true);
        }
      }
    });
  });
}

describe('assignRows', () => {
  const el = (id: string, top: number, left: number) =>
    ({ id, type: 'text', text: id, top, left, row: 0 }) as unknown as import('../src/core/model').ChallengeElement;

  it('puts elements with nearby tops on one row, ordered left to right', () => {
    const rows = assignRows([el('units', 842, 156), el('input', 848, 62), el('label', 852, 20), el('next', 900, 0), el('title', 0, 0)]);
    expect(rows.map((e) => [e.id, e.row])).toEqual([
      ['title', 0],
      ['label', 1],
      ['input', 1],
      ['units', 1],
      ['next', 2],
    ]);
  });
});
