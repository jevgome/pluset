// Small DOM helpers shared by the viewer and the practice panel.

import renderMathInElement from 'katex/contrib/auto-render';
import type { Rich } from '../core/model';
import { expandZyMarkup, normalizeLatex } from '../core/zymarkup';
import { sanitizeHtml } from './sanitize';

export type Child = Node | string | null | undefined | false;

export function h(tag: string, props: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const looksLikeHtml = (s: string) => /<\/?[a-z][\s\S]*>/i.test(s);
const plainToHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

/** Book HTML (or plain text with newlines), sanitized. */
export function richEl(content: Rich | string, cls = 'zy-rich'): HTMLElement {
  const html = typeof content === 'string' ? content : content.html;
  const el = h('div', { class: cls });
  el.append(sanitizeHtml(normalizeLatex(looksLikeHtml(html) ? html : plainToHtml(html))));
  return el;
}

/**
 * Challenge text: a mix of HTML and LaTeX where newlines are meaningful,
 * so it is rendered with `white-space: pre-line` rather than converting newlines.
 */
export function challengeTextEl(text: string, cls = 'zy-ch-text'): HTMLElement {
  const el = h('div', { class: `${cls} zy-preline` });
  el.append(sanitizeHtml(normalizeLatex(expandZyMarkup(text.trim()))));
  return el;
}

/** Groups consecutive items with the same row into one-line flex containers. */
export function inRows<T extends { row: number }>(items: T[], render: (item: T) => HTMLElement | null): HTMLElement[] {
  const out: HTMLElement[] = [];
  let current: HTMLElement | null = null;
  let currentRow: number | null = null;
  for (const item of items) {
    const el = render(item);
    if (!el) continue;
    if (current === null || item.row !== currentRow) {
      current = h('div', { class: 'zy-row' });
      currentRow = item.row;
      out.push(current);
    }
    current.append(el);
  }
  return out;
}

/** Renders LaTeX (\( \), \[ \], $$ $$) inside `root`. */
export function typeset(root: HTMLElement) {
  renderMathInElement(root, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false },
    ],
    throwOnError: false,
    strict: false,
    trust: false,
  });
}
