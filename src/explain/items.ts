// Turns a captured section into the list of questions the on-page "Explain" popup
// offers, one entry per question of each activity, with the book's own answer and
// explanation when the book provides them (participation activities). Challenge
// activities are randomized per student, so their answer has to be worked out from
// the problem shown on the page.
//
// Pure (no DOM): runs in the service worker and in tests.

import type { Section } from '../core/model';
import { sectionLabel } from '../core/model';
import { expandZyMarkup, normalizeLatex } from '../core/zymarkup';
import { htmlToText } from '../ai/text';

export type ExplainKind = 'multipleChoice' | 'shortAnswer' | 'definitionMatch' | 'challenge';

export interface ExplainItem {
  /** Stable key: "<block id>:<question index>". */
  key: string;
  blockId: number;
  /** Position of the activity among the section's activities (matches page order). */
  activityIndex: number;
  /** Activity number as zyBooks shows it, e.g. "8.5.3" (participation and challenge are numbered separately). */
  number: string;
  kind: ExplainKind;
  caption: string;
  questionIndex: number;
  /** Short label for the dropdown. */
  label: string;
  /** Question text (plain text, LaTeX left in \( \) form). */
  prompt: string;
  /** The book's answer, when it has one (not for challenge activities). */
  bookAnswer: string | null;
  bookExplanation: string | null;
}

const txt = (html: string) => htmlToText(normalizeLatex(expandZyMarkup(html))).trim();
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function explainItems(section: Section): ExplainItem[] {
  const items: ExplainItem[] = [];
  const label = sectionLabel(section);
  let activityIndex = 0;
  let participation = 0;
  let challenge = 0;

  for (const b of section.blocks) {
    if (b.kind === 'text' || b.kind === 'container' || b.kind === 'unknown') continue;
    // Animations are numbered as participation activities on the page but have no questions.
    const isChallenge = b.kind === 'challenge';
    const number = `${label}.${isChallenge ? ++challenge : ++participation}`;
    const index = activityIndex++;
    if (b.kind === 'animation') continue;

    const caption = oneLine(htmlToText(b.caption));
    const base = { blockId: b.id, activityIndex: index, number, kind: b.kind, caption };
    const head = `${isChallenge ? 'Challenge' : 'Activity'} ${number}`;

    switch (b.kind) {
      case 'multipleChoice':
        b.questions.forEach((q, i) => {
          const correct = q.choices.filter((c) => c.correct);
          const prompt = txt(q.prompt.html);
          items.push({
            ...base,
            key: `${b.id}:${i}`,
            questionIndex: i,
            label: `${head} Q${i + 1}: ${clip(oneLine(prompt), 70)}`,
            prompt: [prompt, ...q.choices.map((c, j) => `${String.fromCharCode(97 + j)}) ${oneLine(txt(c.label.html))}`)].join('\n'),
            bookAnswer: correct.map((c) => oneLine(txt(c.label.html))).join(' / ') || null,
            bookExplanation: correct.map((c) => txt(c.explanation.html)).filter(Boolean).join('\n') || null,
          });
        });
        break;
      case 'shortAnswer':
        b.questions.forEach((q, i) => {
          const prompt = [txt(q.prompt.html), q.textAfter ? txt(q.textAfter) : ''].filter(Boolean).join(' ');
          const answer = q.preferred ?? q.answers[0] ?? null;
          const others = q.answers.filter((a) => a !== answer);
          items.push({
            ...base,
            key: `${b.id}:${i}`,
            questionIndex: i,
            label: `${head} Q${i + 1}: ${clip(oneLine(prompt), 70)}`,
            prompt,
            bookAnswer: answer ? `${answer}${others.length ? ` (also accepted: ${others.join(', ')})` : ''}` : null,
            bookExplanation: txt(q.explanation.html) || null,
          });
        });
        break;
      case 'definitionMatch':
        items.push({
          ...base,
          key: `${b.id}:0`,
          questionIndex: 0,
          label: `${head}: ${clip(caption || 'Matching', 70)}`,
          prompt: `Match each term to its definition.\nTerms: ${b.terms.map((t) => txt(t.term)).join('; ')}`,
          bookAnswer: b.terms.map((t) => `${txt(t.term)} → ${txt(t.definition)}`).join('\n'),
          bookExplanation: b.terms.map((t) => (t.explanation ? `${txt(t.term)}: ${txt(t.explanation)}` : '')).filter(Boolean).join('\n') || null,
        });
        break;
      case 'challenge':
        items.push({
          ...base,
          key: `${b.id}:0`,
          questionIndex: 0,
          label: `${head}: ${clip(caption || 'Challenge activity', 70)}`,
          prompt: '',
          bookAnswer: null,
          bookExplanation: null,
        });
        break;
    }
  }
  return items;
}
