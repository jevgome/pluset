// Reads a study guide file the student picks (PDF, Word, plain text/Markdown/LaTeX,
// or an image) into what the AI request needs: its text, plus the original PDF or
// image for providers that can read those directly.

export interface StudyGuide {
  name: string;
  /** Extracted text ("" when none could be extracted, e.g. an image or a scanned PDF). */
  text: string;
  /** Base64 of the original PDF, when the file is a PDF. */
  pdf: string | null;
  /** The file itself, when it is an image. */
  image: { mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string } | null;
  pages: number | null;
}

export const STUDY_GUIDE_ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.tex,.text,.csv,.png,.jpg,.jpeg,.gif,.webp';

const MAX_BYTES = 30 * 1024 * 1024;
/** Plenty for a study guide; keeps a huge file from blowing up the request. */
const MAX_TEXT = 300_000;

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as const;
const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'tex', 'text', 'csv']);

export class StudyGuideError extends Error {}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n[…the rest of the file was cut off]` : s);

export async function readStudyGuide(file: File): Promise<StudyGuide> {
  if (file.size > MAX_BYTES) throw new StudyGuideError(`${file.name} is larger than 30 MB.`);
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const base = { name: file.name, pdf: null, image: null, pages: null };

  if (ext === 'pdf' || file.type === 'application/pdf') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = toBase64(bytes); // before pdf.js, which takes ownership of the buffer
    const { text, pages } = await pdfText(bytes);
    return { ...base, text: clip(text), pdf, pages };
  }
  if (ext === 'docx') {
    const xml = await zipEntryText(await file.arrayBuffer(), 'word/document.xml');
    if (xml === null) throw new StudyGuideError(`Couldn't read ${file.name} as a Word document.`);
    return { ...base, text: clip(docxXmlToText(xml)) };
  }
  if (ext in IMAGE_TYPES) {
    const mediaType = IMAGE_TYPES[ext as keyof typeof IMAGE_TYPES];
    return { ...base, text: '', image: { mediaType, data: toBase64(new Uint8Array(await file.arrayBuffer())) } };
  }
  if (TEXT_EXT.has(ext) || file.type.startsWith('text/')) return { ...base, text: clip(await file.text()) };
  throw new StudyGuideError(`Pluset can't read .${ext} files. Use a PDF, Word (.docx), text or image file.`);
}

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: bytes });
  const doc = await task.promise;
  try {
    const out: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = '';
      const lines: string[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line.trimEnd());
          line = '';
        }
      }
      if (line.trim()) lines.push(line.trimEnd());
      out.push(`--- Page ${i} ---\n${lines.join('\n')}`);
    }
    return { text: out.join('\n\n'), pages: doc.numPages };
  } finally {
    await task.destroy();
  }
}

/* ---------- Word (.docx) ---------- */

/** Reads one file out of a ZIP archive (stored or deflated), or null if it isn't there. */
export async function zipEntryText(buf: ArrayBuffer, name: string): Promise<string | null> {
  const bytes = new Uint8Array(buf);
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= bytes.length; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) return null;
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    if (dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)) === name) {
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const data = bytes.slice(start, start + size);
      if (method === 0) return dec.decode(data);
      if (method !== 8) return null;
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return dec.decode(await new Response(stream).arrayBuffer());
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const decodeXml = (s: string) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e: string) => {
    const named: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
    if (named[e.toLowerCase()]) return named[e.toLowerCase()]!;
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });

/** Text of a Word document.xml: one line per paragraph, including equation (OMML) text. */
export function docxXmlToText(xml: string): string {
  const paragraphs = xml.split(/<w:p[\s>]/).slice(1);
  const lines = paragraphs.map((p) => {
    let line = '';
    for (const m of p.matchAll(/<(w|m):t(?:\s[^>]*)?>([\s\S]*?)<\/\1:t>|<w:tab\/>|<w:br\/>/g)) {
      if (m[0] === '<w:tab/>') line += '\t';
      else if (m[0] === '<w:br/>') line += '\n';
      else line += decodeXml(m[2] ?? '');
    }
    return line.trimEnd();
  });
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
