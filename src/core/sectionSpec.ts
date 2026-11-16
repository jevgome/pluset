// Parses what the user types into the section picker.
//   "8.5"        -> one section
//   "8.1-8.4"    -> a range within one chapter ("8.1-4" also works)
//   "8"          -> the whole chapter (fetch until zyBooks says the section doesn't exist)
// Items are separated by commas, semicolons or whitespace.

export type SectionRequest =
  | { kind: 'section'; chapter: number; section: number }
  | { kind: 'chapter'; chapter: number };

export class SectionSpecError extends Error {}

const POSITIVE = /^[1-9]\d*$/;

function num(s: string, token: string): number {
  if (!POSITIVE.test(s)) throw new SectionSpecError(`"${token}" isn't a valid section. Use forms like 8.5, 8.1-8.4 or 8.`);
  return Number(s);
}

export function parseSectionSpec(input: string): SectionRequest[] {
  const out: SectionRequest[] = [];
  const seen = new Set<string>();
  const push = (r: SectionRequest) => {
    const key = r.kind === 'chapter' ? `${r.chapter}` : `${r.chapter}.${r.section}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  };

  for (const token of input.split(/[\s,;]+/).filter(Boolean)) {
    const range = token.split('-');
    if (range.length === 2) {
      const [a = '', b = ''] = range;
      const [ch, from] = a.split('.');
      if (from === undefined) throw new SectionSpecError(`"${token}": a range needs a section, like 8.1-8.4.`);
      const end = b.includes('.') ? b.split('.') : [ch, b];
      if (end.length !== 2 || end[0] !== ch) {
        throw new SectionSpecError(`"${token}": ranges must stay within one chapter.`);
      }
      const chapter = num(ch ?? '', token);
      const start = num(from, token);
      const stop = num(end[1] ?? '', token);
      if (stop < start) throw new SectionSpecError(`"${token}": the range is backwards.`);
      if (stop - start > 50) throw new SectionSpecError(`"${token}": that range is too large.`);
      for (let s = start; s <= stop; s++) push({ kind: 'section', chapter, section: s });
    } else if (range.length === 1) {
      const parts = token.split('.');
      if (parts.length === 1) push({ kind: 'chapter', chapter: num(parts[0] ?? '', token) });
      else if (parts.length === 2) push({ kind: 'section', chapter: num(parts[0] ?? '', token), section: num(parts[1] ?? '', token) });
      else throw new SectionSpecError(`"${token}" isn't a valid section.`);
    } else {
      throw new SectionSpecError(`"${token}" isn't a valid section.`);
    }
  }
  return out;
}
