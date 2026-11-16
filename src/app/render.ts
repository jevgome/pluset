// Renders a normalized section for the capture viewer.
// By design this never shows answers, solutions or generator code for the
// book's own activities: those are graded. Challenge activities get a practice
// panel that generates *new* versions, with solutions available after an attempt.

import type { Block, ChallengeBlock, ChallengeElement, Section } from '../core/model';
import { sectionLabel } from '../core/model';
import { challengeTextEl, h, inRows, richEl, typeset, type Child } from './dom';
import { practicePanel } from './practice';

export { h };

/** Shown where a challenge value is randomized each attempt (${var} in the template). */
const PLACEHOLDER = '▢';
const fillPlaceholders = (s: string) => s.replace(/\$\{\s*[A-Za-z_]\w*\s*\}/g, PLACEHOLDER);

function card(kindLabel: string, caption: string, modifier: string, ...body: Child[]): HTMLElement {
  return h(
    'section',
    { class: `zy-card zy-card--${modifier}` },
    h('header', { class: 'zy-card__header' }, h('span', { class: 'zy-card__kind' }, kindLabel), caption ? h('span', { class: 'zy-card__caption' }, caption) : null),
    ...body,
  );
}

function capturedNote(items: string[]): HTMLElement {
  return h('p', { class: 'zy-captured' }, `Captured for generation: ${items.join(', ')}.`);
}

function challengeElement(el: ChallengeElement): HTMLElement | null {
  switch (el.type) {
    case 'text': {
      const text = (el.text ?? '').trim();
      if (!text || text === 'add text') return null;
      return challengeTextEl(fillPlaceholders(text));
    }
    case 'shortanswer':
      return h('span', { class: 'zy-blank', title: fillPlaceholders(el.ariaLabel ?? 'Answer') });
    case 'dropdown':
      return h('span', { class: 'zy-blank zy-blank--dropdown', title: fillPlaceholders(el.ariaLabel ?? 'Choose') }, '▾');
    case 'image':
      if (!el.image) return null;
      return h('figure', { class: 'zy-ch-figure' }, h('div', { class: 'zy-img-missing' }, 'Figure (challenge images aren’t downloaded yet)'), el.image.alt ? h('figcaption', {}, el.image.alt) : null);
    case 'table':
      return h('p', { class: 'zy-muted' }, '[Table]');
    default:
      return h('p', { class: 'zy-muted' }, `[${el.type || 'unknown'} element]`);
  }
}

function renderChallenge(b: ChallengeBlock): HTMLElement {
  const codeLines = [b.sharedCode, ...b.levels.map((l) => l.code)].join('\n').split('\n').filter((l) => l.trim()).length;
  const levels = b.levels.map((level) =>
    h(
      'div',
      { class: 'zy-level' },
      h('h4', { class: 'zy-level__title' }, `${level.name}${b.levels.length > 1 ? ` of ${b.levels.length}` : ''}`),
      ...level.questions.flatMap((q) => inRows(q.elements, challengeElement)),
    ),
  );
  return card(
    'Challenge activity',
    b.caption,
    'challenge',
    ...levels,
    h('p', { class: 'zy-muted' }, `${PLACEHOLDER} = a value that is randomized each attempt.`),
    capturedNote([`generator code (${codeLines} lines)`, 'answer rules', 'solution templates']),
    practicePanel(b),
  );
}

function renderBlock(b: Block): HTMLElement {
  switch (b.kind) {
    case 'text':
      return richEl(b.body, 'zy-text');
    case 'container':
      return h(
        'section',
        { class: `zy-container zy-container--${b.variant.toLowerCase().replace(/\W+/g, '-')}`, ...(b.anchor ? { id: b.anchor } : {}) },
        h('header', { class: 'zy-container__header' }, h('span', { class: 'zy-card__kind' }, b.label ? `${b.variant} ${b.label}` : b.variant), b.caption ? h('span', { class: 'zy-card__caption' }, b.caption) : null),
        richEl(b.body),
      );
    case 'multipleChoice':
      return card(
        'Participation activity',
        b.caption,
        'participation',
        h(
          'ol',
          { class: 'zy-questions' },
          ...b.questions.map((q) =>
            h('li', {}, richEl(q.prompt), h('ul', { class: 'zy-choices' }, ...q.choices.map((c) => h('li', {}, richEl(c.label))))),
          ),
        ),
        capturedNote(['correct choices', 'explanations']),
      );
    case 'shortAnswer':
      return card(
        'Participation activity',
        b.caption,
        'participation',
        h('ol', { class: 'zy-questions' }, ...b.questions.map((q) => h('li', {}, richEl(q.prompt)))),
        capturedNote(['accepted answers', 'hints', 'explanations']),
      );
    case 'animation':
      return card('Animation', b.caption, 'animation', richEl(b.description || '(No description provided.)', 'zy-anim-desc'));
    case 'definitionMatch': {
      const sorted = (xs: string[]) => [...xs].sort((a, c) => a.localeCompare(c));
      return card(
        'Matching activity',
        b.caption,
        'participation',
        h(
          'div',
          { class: 'zy-match' },
          h('div', {}, h('h4', {}, 'Terms'), h('ul', {}, ...sorted(b.terms.map((t) => t.term)).map((t) => h('li', {}, richEl(t))))),
          h('div', {}, h('h4', {}, 'Definitions'), h('ul', {}, ...sorted(b.terms.map((t) => t.definition)).map((d) => h('li', {}, richEl(d))))),
        ),
        capturedNote(['correct pairs', 'explanations']),
      );
    }
    case 'challenge':
      return renderChallenge(b);
    case 'unknown':
      return card('Unsupported content', b.caption, 'unknown', h('p', { class: 'zy-muted' }, `Type “${b.resourceType}”${b.tool ? `, tool “${b.tool}”` : ''}. This won’t be used for generation yet.`));
  }
}

export function summarize(section: Section) {
  const count = (pred: (b: Block) => boolean) => section.blocks.filter(pred).length;
  return {
    participation: count((b) => b.activityType === 'participation'),
    challenge: count((b) => b.kind === 'challenge'),
    figures: section.blocks.reduce((n, b) => n + ('body' in b ? b.body.images.length : 0), 0),
    unsupported: count((b) => b.kind === 'unknown'),
  };
}

export function renderSection(section: Section): HTMLElement {
  const s = summarize(section);
  const root = h(
    'article',
    { class: 'zy-section' },
    h('h2', { class: 'zy-section__title' }, `${sectionLabel(section)} ${section.title}`),
    h(
      'p',
      { class: 'zy-section__summary' },
      `${s.participation} participation activities · ${s.challenge} challenge activities · ${s.figures} images` +
        (s.unsupported ? ` · ${s.unsupported} unsupported` : ''),
    ),
    ...section.blocks.map(renderBlock),
  );
  typeset(root);
  return root;
}
