import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { cheatSheetInstructions, cleanSheet, guideContent } from '../src/ai/cheatSheet';
import { DEFAULT_SETTINGS } from '../src/ai/settings';
import { docxXmlToText, zipEntryText, type StudyGuide } from '../src/ai/studyGuide';

/** A minimal ZIP archive with the given (deflated) entries. */
function zip(entries: Record<string, string>): ArrayBuffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name);
    const data = deflateRawSync(Buffer.from(text));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(text.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(text.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...locals, cd, eocd]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length) as ArrayBuffer;
}

const DOC = `<w:document><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Exam 2 &amp; topics</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Bernoulli: </w:t></w:r><m:oMath><m:r><m:t>p+ρV²/2</m:t></m:r></m:oMath><w:r><w:tab/><w:t>(8.5)</w:t></w:r></w:p>
</w:body></w:document>`;

describe('study guide files', () => {
  it('reads Word paragraphs, including equation text', () => {
    expect(docxXmlToText(DOC)).toBe('Exam 2 & topics\nBernoulli: p+ρV²/2\t(8.5)');
  });

  it('finds a deflated entry in a ZIP archive', async () => {
    const buf = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': DOC });
    expect(await zipEntryText(buf, 'word/document.xml')).toBe(DOC);
    expect(await zipEntryText(buf, 'missing.xml')).toBeNull();
  });
});

describe('cheat sheet', () => {
  const guide: StudyGuide = { name: 'guide.pdf', text: 'Topic 1', pdf: 'JVBERi0=', image: null, pages: 2 };

  it('sends the PDF itself to the Claude API and its text to Claude Code', () => {
    const api = guideContent(guide, { ...DEFAULT_SETTINGS, provider: 'anthropic' });
    expect(api.some((p) => p.type === 'document')).toBe(true);
    const cc = guideContent(guide, { ...DEFAULT_SETTINGS, provider: 'claude-code' });
    expect(cc).toHaveLength(1);
    expect(cc[0]).toMatchObject({ type: 'text' });
    expect((cc[0] as { text: string }).text).toContain('Topic 1');
  });

  it('refuses an image-only guide for a text-only model', () => {
    const img: StudyGuide = { ...guide, text: '', pdf: null, image: { mediaType: 'image/png', data: 'x' } };
    expect(() => guideContent(img, { ...DEFAULT_SETTINGS, provider: 'claude-code' })).toThrow(/image/);
  });

  it('cleans model output', () => {
    const sheet = cleanSheet({
      title: '',
      groups: [
        { heading: 'Flow', items: [{ kind: 'equation', name: 'Bernoulli', latex: '\\[p + \\rho V^2/2\\]', text: '', conditions: ['steady', ''], source: '8.5' }] },
        { heading: 'Empty', items: [{ kind: 'concept', name: '', latex: '', text: '', conditions: [], source: '' }] },
      ],
    });
    expect(sheet.title).toBe('Cheat sheet');
    expect(sheet.groups).toHaveLength(1);
    expect(sheet.groups[0]!.items[0]).toMatchObject({ latex: 'p + \\rho V^2/2', conditions: ['steady'] });
    expect(sheet.missing_topics).toEqual([]);
  });

  it('scopes the request to the guide and the focus', () => {
    const text = cheatSheetInstructions({ hasGuide: true, sections: ['8.4', '8.5'], focus: 'Part B only', columns: 4 });
    expect(text).toContain('study guide decides');
    expect(text).toContain('"Part B only"');
    expect(text).toContain('4 narrow columns');
  });
});
