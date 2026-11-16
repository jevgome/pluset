// Builds the "book material" sent to the AI: every captured section in reading
// order as compact text, including answers and explanations of the book's own
// activities (as examples of style and scope - never shown to the student), and
// one generated instance of each challenge level with its worked solution.

import type { Block, ChallengeBlock, Section } from '../core/model';
import { sectionLabel } from '../core/model';
import { expandZyMarkup, normalizeLatex } from '../core/zymarkup';
import type { ProblemInstance } from '../engine/instantiate';
import { htmlToText } from './text';

export interface BookImage {
  id: string;
  url: string;
  /** e.g. "Figure 8.5.1" */
  label: string;
  caption: string;
}

export interface BookContext {
  text: string;
  images: BookImage[];
  /** Section labels included, e.g. ["8.4", "8.5"]. */
  sections: string[];
}

/** Produces one generated instance of a challenge level (or null if it can't be generated). */
export type ExampleMaker = (block: ChallengeBlock, levelIndex: number) => Promise<ProblemInstance | null>;

const txt = (html: string) => htmlToText(normalizeLatex(expandZyMarkup(html)));
const plain = (s: string) => htmlToText(s).replace(/\n+/g, ' ').trim();

function instanceText(p: ProblemInstance): string {
  const lines: string[] = [];
  let answers = 0;
  let row: number | null = null;
  let line = '';
  const flush = () => {
    if (line.trim()) lines.push(line.trim());
    line = '';
  };
  for (const part of p.parts) {
    if (part.row !== row) {
      flush();
      row = part.row;
    }
    if (part.kind === 'text') line += ` ${txt(part.html).replace(/\n+/g, ' ')}`;
    else if (part.kind === 'input' || part.kind === 'dropdown') {
      answers++;
      const spec = part.answer;
      const raw = spec.kind === 'choice' ? spec.correct : spec.answers[0] ?? '';
      // Some book code leaves answers unrounded (4.125296124941927); 4 significant figures is plenty here.
      const value = /^-?\d+\.\d{6,}$/.test(raw) ? String(Number(Number(raw).toPrecision(4))) : raw;
      line += ` [answer ${answers}: ${value}]`;
    } else if (part.kind === 'image') line += ` [Figure: ${part.image.alt}]`;
  }
  flush();
  const out = [`Problem:\n${lines.join('\n')}`];
  if (p.solutionHtml) out.push(`Worked solution:\n${txt(p.solutionHtml)}`);
  return out.join('\n');
}

async function blockText(b: Block, section: Section, example: ExampleMaker | null, images: BookImage[]): Promise<string> {
  switch (b.kind) {
    case 'text':
      return txt(b.body.html);
    case 'container': {
      if (b.variant === 'Video') return '';
      const title = [b.label ? `${b.variant} ${b.label}` : b.variant, b.caption && plain(b.caption)].filter(Boolean).join(': ');
      if (b.variant === 'Figure' || b.variant === 'Table') {
        b.body.images.forEach((img, i) => {
          if (img.url) {
            images.push({
              id: img.id,
              url: img.url,
              label: `${b.label ? `${b.variant} ${b.label}` : b.variant}${b.body.images.length > 1 ? ` (image ${i + 1})` : ''}`,
              caption: plain(b.caption),
            });
          }
        });
      }
      return `[${title}]\n${txt(b.body.html)}\n[end ${b.variant}]`;
    }
    case 'multipleChoice':
      return [
        `[Participation activity (multiple choice): ${plain(b.caption)}]`,
        ...b.questions.map((q, i) =>
          [
            `Q${i + 1}. ${txt(q.prompt.html)}`,
            ...q.choices.map(
              (c, j) => `  ${String.fromCharCode(97 + j)}) ${txt(c.label.html)}${c.correct ? '  [correct]' : ''} - ${txt(c.explanation.html)}`,
            ),
          ].join('\n'),
        ),
        '[end activity]',
      ].join('\n');
    case 'shortAnswer':
      return [
        `[Participation activity (short answer): ${plain(b.caption)}]`,
        ...b.questions.map((q, i) =>
          [
            `Q${i + 1}. ${txt(q.prompt.html)}`,
            `  Accepted answers: ${q.answers.join(' | ')}`,
            q.hint ? `  Hint: ${txt(q.hint)}` : '',
            `  Explanation: ${txt(q.explanation.html)}`,
          ]
            .filter(Boolean)
            .join('\n'),
        ),
        '[end activity]',
      ].join('\n');
    case 'animation':
      return `[Animation: ${plain(b.caption)}]\n${txt(b.description)}\n[end animation]`;
    case 'definitionMatch':
      return [
        `[Participation activity (matching): ${plain(b.caption)}]`,
        ...b.terms.map((t) => `- ${txt(t.term)}: ${txt(t.definition)}${t.explanation ? ` (${txt(t.explanation)})` : ''}`),
        '[end activity]',
      ].join('\n');
    case 'challenge': {
      const parts = [`[Challenge activity: ${plain(b.caption)}]`];
      for (let i = 0; i < b.levels.length; i++) {
        const inst = example ? await example(b, i).catch(() => null) : null;
        parts.push(
          `Level ${i + 1} of ${b.levels.length}${inst ? ' (one randomized instance)' : ''}:`,
          inst ? instanceText(inst) : '(could not generate an instance)',
        );
      }
      parts.push('[end activity]');
      return parts.join('\n');
    }
    case 'unknown':
      return '';
  }
}

export async function buildBookContext(sections: Section[], example: ExampleMaker | null): Promise<BookContext> {
  const images: BookImage[] = [];
  const chunks: string[] = [];
  for (const s of sections) {
    const body: string[] = [];
    for (const b of s.blocks) {
      const t = (await blockText(b, s, example, images)).trim();
      if (t) body.push(t);
    }
    chunks.push(`===== SECTION ${sectionLabel(s)}: ${s.title} =====\n\n${body.join('\n\n')}\n\n===== END SECTION ${sectionLabel(s)} =====`);
  }
  return { text: chunks.join('\n\n'), images, sections: sections.map(sectionLabel) };
}

/** Rough token estimate for cost previews (about 3.5 characters per token for this kind of text). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);
