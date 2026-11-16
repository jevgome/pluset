// Turns a captured section into the answers the on-page "Show answer" buttons
// display: one entry per question of each participation activity, with the book's
// own answer and explanation. Challenge activities are randomized per student and
// the book has no fixed answer for them, so they get no entry.
//
// Pure (no DOM): runs in the service worker and in tests.

import type { Section } from '../core/model';
import { sectionLabel } from '../core/model';
import { expandZyMarkup, normalizeLatex } from '../core/zymarkup';
import { htmlToText } from '../ai/text';

export type ExplainKind = 'multipleChoice' | 'shortAnswer' | 'definitionMatch';

export interface ExplainItem {
  /** Stable key: "<block id>:<question index>". */
  key: string;
  blockId: number;
  /** Position of the activity among the section's activities (matches page order). */
  activityIndex: number;
  /** Activity number as zyBooks shows it, e.g. "8.5.3" (participation and challenge are numbered separately). */
  number: string;
  kind: ExplainKind;
  /** Question within the activity; definition matching has a single entry for the whole activity. */
  questionIndex: number;
  /** The book's answer (plain text, LaTeX left in \( \) form). */
  bookAnswer: string;
  bookExplanation: string | null;
}

const txt = (html: string) => htmlToText(normalizeLatex(expandZyMarkup(html))).trim();
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export function explainItems(section: Section): ExplainItem[] {
  const items: ExplainItem[] = [];
  const label = sectionLabel(section);
  let activityIndex = 0;
  let participation = 0;
  let challenge = 0;

  for (const b of section.blocks) {
    if (b.kind === 'text' || b.kind === 'container' || b.kind === 'unknown') continue;
    // Animations are numbered as participation activities on the page but have no questions.
    const number = `${label}.${b.kind === 'challenge' ? ++challenge : ++participation}`;
    const index = activityIndex++;
    const base = { blockId: b.id, activityIndex: index, number };

    switch (b.kind) {
      case 'multipleChoice':
        b.questions.forEach((q, i) => {
          const correct = q.choices.filter((c) => c.correct);
          if (!correct.length) return;
          items.push({
            ...base,
            kind: b.kind,
            key: `${b.id}:${i}`,
            questionIndex: i,
            bookAnswer: correct.map((c) => oneLine(txt(c.label.html))).join(' / '),
            bookExplanation: correct.map((c) => txt(c.explanation.html)).filter(Boolean).join('\n') || null,
          });
        });
        break;
      case 'shortAnswer':
        b.questions.forEach((q, i) => {
          const answer = q.preferred ?? q.answers[0];
          if (!answer) return;
          const others = q.answers.filter((a) => a !== answer);
          items.push({
            ...base,
            kind: b.kind,
            key: `${b.id}:${i}`,
            questionIndex: i,
            bookAnswer: `${answer}${others.length ? ` (also accepted: ${others.join(', ')})` : ''}`,
            bookExplanation: txt(q.explanation.html) || null,
          });
        });
        break;
      case 'definitionMatch':
        items.push({
          ...base,
          kind: b.kind,
          key: `${b.id}:0`,
          questionIndex: 0,
          bookAnswer: b.terms.map((t) => `${txt(t.term)} → ${txt(t.definition)}`).join('\n'),
          bookExplanation: b.terms.map((t) => (t.explanation ? `${txt(t.term)}: ${txt(t.explanation)}` : '')).filter(Boolean).join('\n') || null,
        });
        break;
    }
  }
  return items;
}
