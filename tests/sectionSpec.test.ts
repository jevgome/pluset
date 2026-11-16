import { describe, expect, it } from 'vitest';
import { parseSectionSpec, SectionSpecError } from '../src/core/sectionSpec';

describe('parseSectionSpec', () => {
  it('parses single sections, ranges and chapters', () => {
    expect(parseSectionSpec('8.5, 6.8-6.9 7')).toEqual([
      { kind: 'section', chapter: 8, section: 5 },
      { kind: 'section', chapter: 6, section: 8 },
      { kind: 'section', chapter: 6, section: 9 },
      { kind: 'chapter', chapter: 7 },
    ]);
  });

  it('accepts short ranges and removes duplicates', () => {
    expect(parseSectionSpec('8.1-3; 8.2')).toEqual([
      { kind: 'section', chapter: 8, section: 1 },
      { kind: 'section', chapter: 8, section: 2 },
      { kind: 'section', chapter: 8, section: 3 },
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(parseSectionSpec('  ')).toEqual([]);
  });

  it.each(['8.x', '8.1-9.2', '8.4-8.1', '1.2.3', '0.1', '8-9', '8.1-8.2-8.3'])('rejects %s', (bad) => {
    expect(() => parseSectionSpec(bad)).toThrow(SectionSpecError);
  });
});
