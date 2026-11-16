// "Show answer" buttons on zyBooks pages: each question of a participation activity
// gets its own button that reveals the book's answer and explanation for just that
// question. Challenge activities are randomized per student, so their button reads the
// values the page shows and recreates that version from the book's generator code
// (service worker + offscreen Python). Nothing is typed into or submitted on the page.
//
// Built separately as one classic script (vite.content.config.ts): content scripts
// can't load ES module chunks, so this file imports only types and katex.

import katex from 'katex';
import type { ExplainItem } from '../explain/items';
import type { ChallengeRef, ExplainRequest, ItemsResponse, SectionRef, SolveResponse, SolvedLevel } from '../explain/messages';

// ---------- page helpers ----------

function sectionFromUrl(url: string): SectionRef | null {
  const m = /^https:\/\/learn\.zybooks\.com\/zybook\/([^/?#]+)\/chapter\/(\d+)\/section\/(\d+)/.exec(url);
  return m ? { book: decodeURIComponent(m[1]!), chapter: Number(m[2]), section: Number(m[3]) } : null;
}

const TITLE_RE = /\b(PARTICIPATION|CHALLENGE)\s+ACTIVITY\b\s*(\d+\.\d+\.\d+)?/i;

/** Activity containers on the page, in reading order. */
function activityElements(): HTMLElement[] {
  const known = [...document.querySelectorAll<HTMLElement>('.interactive-activity-container')];
  if (known.length) return known;
  // Fallback: find the "PARTICIPATION ACTIVITY 8.5.1" titles and climb to each activity's own container.
  const titles = [...document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,div,span')].filter(
    (el) => el.children.length <= 4 && TITLE_RE.test(el.textContent ?? '') && (el.textContent ?? '').length < 300,
  );
  const leaves = titles.filter((t) => !titles.some((o) => o !== t && t.contains(o)));
  return leaves.map((t) => {
    let el: HTMLElement = t;
    while (el.parentElement && el.parentElement !== document.body) {
      const count = leaves.filter((l) => el.parentElement!.contains(l)).length;
      if (count > 1) break;
      el = el.parentElement;
    }
    return el;
  });
}

function activityInfo(el: HTMLElement): { kind: 'participation' | 'challenge' | null; number: string | null } {
  const head = (el.textContent ?? '').slice(0, 400);
  const m = TITLE_RE.exec(head);
  const kind = m ? (m[1]!.toLowerCase() as 'participation' | 'challenge') : el.classList.contains('challenge') ? 'challenge' : null;
  return { kind, number: m?.[2] ?? null };
}

/** The items for the activity shown by `el` (by its "8.5.3" number, else by position). */
function itemsFor(el: HTMLElement, index: number, items: ExplainItem[]): ExplainItem[] {
  const info = activityInfo(el);
  if (info.kind === 'challenge') return [];
  return items.filter((i) => (info.number ? i.number === info.number : i.activityIndex === index));
}

function challengeFor(el: HTMLElement, index: number, challenges: ChallengeRef[]): ChallengeRef | null {
  const info = activityInfo(el);
  if (info.kind === 'participation') return null;
  return challenges.find((c) => (info.number ? c.number === info.number : c.activityIndex === index)) ?? null;
}

const MATH_CONTAINERS = 'mjx-container, .MathJax, .MathJax_Display, .MathJax_SVG, .MathJax_CHTML, .katex, math';

/** One readable form of a rendered formula: its TeX source if the page kept it, else its MathML leaves. */
function mathSource(el: Element): string {
  const tex =
    el.querySelector('annotation[encoding*="tex" i]')?.textContent ??
    (el.nextElementSibling?.matches('script[type^="math/tex"]') ? el.nextElementSibling.textContent : null);
  if (tex) return tex;
  const math = el.matches('math') ? el : el.querySelector('math');
  if (math) {
    const leaves = [...math.querySelectorAll('mi, mn, mo, mtext, ms')].map((l) => l.textContent ?? '');
    if (leaves.length) return leaves.join(' ');
  }
  return el.getAttribute('aria-label') ?? el.textContent ?? '';
}

/**
 * The text of an activity as the student sees it, with each formula included once
 * (pages keep several copies: rendered glyphs, MathML for screen readers, TeX source).
 * Typed answers aren't included; answer boxes contribute their labels.
 */
function pageTextOf(root: Element): string {
  const out: string[] = [];
  const done = new Set<Element>();
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out.push(n.textContent ?? '');
      return;
    }
    if (!(n instanceof Element) || done.has(n)) return;
    if (n.classList.contains(HOST_CLASS) || n.matches('style, noscript, .MathJax_Preview, mjx-assistive-mml, .MJX_Assistive_MathML')) return;
    if (n.matches('script')) {
      if (n.matches('script[type^="math/tex"]')) out.push(` ${n.textContent ?? ''} `);
      return;
    }
    if (n.matches(MATH_CONTAINERS)) {
      out.push(` ${mathSource(n)} `);
      const script = n.nextElementSibling;
      if (script?.matches('script[type^="math/tex"]')) done.add(script);
      return;
    }
    if (n.matches('input, select, textarea')) {
      const label = n.getAttribute('aria-label');
      if (label) out.push(` ${label} `);
      return;
    }
    if (n instanceof HTMLIFrameElement) {
      try {
        if (n.contentDocument?.body) walk(n.contentDocument.body);
      } catch {
        /* cross-origin frame */
      }
      return;
    }
    for (const c of n.childNodes) walk(c);
    out.push(' ');
  };
  walk(root);
  return out.join('').replace(/[ \t]+/g, ' ');
}

function questionElements(activity: HTMLElement): HTMLElement[] {
  return [...activity.querySelectorAll<HTMLElement>('.question-set-question')];
}

// ---------- rendering ----------

/** Text with \( \) and \[ \] math, rendered as native MathML (no fonts or stylesheet needed). */
function mathText(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const re = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) frag.append(text.slice(last, m.index));
    const display = m[1] === undefined;
    const span = document.createElement('span');
    span.className = display ? 'math math--display' : 'math';
    span.innerHTML = katex.renderToString((m[1] ?? m[2] ?? m[3])!, { output: 'mathml', throwOnError: false, displayMode: display });
    frag.append(span);
    last = m.index! + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...children);
  return e;
}

const CSS = `
:host { all: initial; display: block; margin: 8px 0; font: 14px/1.5 system-ui, sans-serif; color: #1a1b1e; }
* { box-sizing: border-box; }
.btn { font: 600 12px/1 system-ui, sans-serif; padding: 6px 10px; border-radius: 6px; border: 1px solid #3b5bdb;
  background: #fff; color: #3b5bdb; cursor: pointer; }
.btn:hover { background: #edf2ff; }
.card { margin-top: 6px; border: 1px solid #b2f2bb; background: #ebfbee; border-radius: 8px; padding: 8px 10px; }
.card[hidden] { display: none; }
.title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #6c757d; }
.answer { font-weight: 600; white-space: pre-wrap; overflow-wrap: anywhere; }
.why { margin-top: 6px; white-space: pre-wrap; overflow-wrap: anywhere; }
.error { color: #c92a2a; font-size: 13px; white-space: pre-wrap; }
.math--display { display: block; margin: 4px 0; overflow-x: auto; }
.muted { color: #6c757d; font-size: 13px; }
.warn { color: #9c6500; font-size: 13px; margin-top: 4px; }
.level + .level { margin-top: 10px; padding-top: 8px; border-top: 1px solid #b2f2bb; }
.level__name { font-weight: 700; }
.row { margin-top: 4px; }
.row__label { color: #495057; font-size: 13px; }
details { margin-top: 6px; }
summary { cursor: pointer; font-size: 13px; font-weight: 600; }
@media (prefers-color-scheme: dark) {
  :host { color: #e9ecef; }
  .btn { background: transparent; color: #91a7ff; border-color: #91a7ff; }
  .btn:hover { background: #25262b; }
  .card { background: #1b3326; border-color: #2b8a3e; }
  .title, .muted, .row__label { color: #adb5bd; }
  .warn { color: #ffc078; }
  .level + .level { border-color: #2b8a3e; }
}
`;

const HOST_CLASS = 'pluset-answer';

/** A shadow-DOM box (so the page's styles don't reach it) whose events don't reach zyBooks' handlers. */
function shadowHost(key: string): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement('div');
  host.className = HOST_CLASS;
  host.dataset.plusetKey = key;
  for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup']) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }
  const root = host.attachShadow({ mode: 'open' });
  root.append(el('style', '', CSS));
  return { host, root };
}

function answerWidget(item: ExplainItem, label: string): HTMLElement {
  const { host, root } = shadowHost(item.key);
  const btn = el('button', 'btn', label);
  btn.type = 'button';
  const card = el(
    'div',
    'card',
    el('div', 'title', 'Answer'),
    el('div', 'answer', mathText(item.bookAnswer)),
    ...(item.bookExplanation ? [el('div', 'why', mathText(item.bookExplanation))] : []),
  );
  card.hidden = true;
  btn.addEventListener('click', () => {
    card.hidden = !card.hidden;
    btn.textContent = card.hidden ? label : 'Hide answer';
  });
  root.append(btn, card);
  return host;
}

function solvedLevel(level: SolvedLevel, showName: boolean): HTMLElement {
  const box = el('div', 'level');
  if (showName) box.append(el('div', 'level__name', level.name));
  if (level.ambiguous) box.append(el('div', 'warn', 'The page doesn’t show enough to pin down your version; other versions with different answers fit it too. Check the values below.'));
  else if (!level.exact) box.append(el('div', 'warn', 'Closest match to your page, not an exact one. Check the values below.'));
  if (level.shown.length) box.append(el('div', 'muted', `Your values: ${level.shown.map(([k, v]) => `${k} = ${v}`).join(', ')}`));
  for (const a of level.answers) {
    box.append(el('div', 'row', el('div', 'row__label', a.label), el('div', 'answer', mathText(a.value))));
  }
  if (level.solution) {
    const d = el('details', '', el('summary', '', 'Book’s solution'), el('div', 'why', mathText(level.solution)));
    box.append(d);
  }
  return box;
}

function challengeWidget(ref: ChallengeRef, activity: HTMLElement, section: () => SectionRef | null): HTMLElement {
  const { host, root } = shadowHost(`challenge:${ref.blockId}`);
  const btn = el('button', 'btn', 'Show answer');
  btn.type = 'button';
  const card = el('div', 'card');
  card.hidden = true;
  let seq = 0;
  btn.addEventListener('click', async () => {
    if (!card.hidden) {
      card.hidden = true;
      btn.textContent = 'Show answer';
      return;
    }
    const s = section();
    if (!s) return;
    const mine = ++seq;
    card.hidden = false;
    btn.textContent = 'Hide answer';
    card.replaceChildren(el('div', 'muted', 'Recreating your version from the numbers on the page… (the first time loads Python, which can take a little while)'));
    // Read the page now: values change when zyBooks moves to another level or a new attempt.
    const pageText = pageTextOf(activity);
    console.debug('[Pluset] challenge page text', ref.number, pageText);
    let res: SolveResponse;
    try {
      res = await send<SolveResponse>({ type: 'pluset:explain:solve', ...s, blockId: ref.blockId, pageText });
    } catch (e) {
      res = { ok: false, error: `${e instanceof Error ? e.message : e}\nIf you just reloaded the extension, reload this page.` };
    }
    if (mine !== seq) return;
    if (!res.ok) {
      card.replaceChildren(el('div', 'error', res.error));
      return;
    }
    card.replaceChildren(
      el('div', 'title', 'Answer for your version'),
      ...res.levels.map((l) => solvedLevel(l, res.levels.length > 1)),
      el('div', 'muted', 'Click again after moving to another level or starting a new attempt; the values change.'),
    );
  });
  root.append(btn, card);
  return host;
}

const hasWidget = (parent: HTMLElement, key: string) =>
  [...parent.children].some((c) => c instanceof HTMLElement && c.classList.contains(HOST_CLASS) && c.dataset.plusetKey === key);

/** Adds a button under each question that has a book answer, and one per challenge activity (if not already there). */
function inject(items: ExplainItem[], challenges: ChallengeRef[], section: () => SectionRef | null) {
  activityElements().forEach((activity, index) => {
    const ch = challengeFor(activity, index, challenges);
    if (ch) {
      if (!hasWidget(activity, `challenge:${ch.blockId}`)) activity.append(challengeWidget(ch, activity, section));
      return;
    }
    const mine = itemsFor(activity, index, items);
    if (!mine.length) return;
    const questions = questionElements(activity);
    for (const item of mine) {
      const q = item.kind !== 'definitionMatch' ? questions[item.questionIndex] : undefined;
      // Without a matching question element (definition matching, or an unexpected layout), put it at the activity's end.
      const parent = q ?? activity;
      if (hasWidget(parent, item.key)) continue;
      const label = q || item.kind === 'definitionMatch' ? 'Show answer' : `Show answer (Q${item.questionIndex + 1})`;
      parent.append(answerWidget(item, label));
    }
  });
}

function showError(text: string, retry: () => void) {
  if (document.querySelector(`.${HOST_CLASS}[data-pluset-key="error"]`)) return;
  const first = activityElements()[0];
  if (!first) return;
  const { host, root } = shadowHost('error');
  const btn = el('button', 'btn', 'Retry');
  btn.type = 'button';
  btn.addEventListener('click', () => {
    host.remove();
    retry();
  });
  root.append(el('div', 'error', `Pluset couldn't load this section's answers: ${text}`), btn);
  first.before(host);
}

// ---------- lifecycle ----------

const send = <T,>(req: ExplainRequest) => chrome.runtime.sendMessage(req) as Promise<T>;

function start() {
  let items: ExplainItem[] = [];
  let challenges: ChallengeRef[] = [];
  let loaded = false;
  let loadSeq = 0;
  const section = () => sectionFromUrl(location.href);

  async function load() {
    const seq = ++loadSeq;
    items = [];
    challenges = [];
    loaded = false;
    document.querySelectorAll(`.${HOST_CLASS}`).forEach((h) => h.remove());
    const ref = sectionFromUrl(location.href);
    if (!ref) return;
    let res: ItemsResponse;
    try {
      res = await send<ItemsResponse>({ type: 'pluset:explain:items', ...ref });
    } catch (e) {
      res = { ok: false, error: `${e instanceof Error ? e.message : e}\nIf you just reloaded the extension, reload this page.` };
    }
    if (seq !== loadSeq) return;
    if (!res.ok) return showError(res.error, () => void load());
    items = res.items;
    challenges = res.challenges;
    loaded = true;
    inject(items, challenges, section);
  }

  // zyBooks renders activities lazily and re-renders them; add buttons to whatever appears.
  let pending = 0;
  new MutationObserver(() => {
    if (!loaded || pending) return;
    pending = window.setTimeout(() => {
      pending = 0;
      inject(items, challenges, section);
    }, 300);
  }).observe(document.body, { childList: true, subtree: true });

  // zyBooks is a single-page app: follow section changes.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    void load();
  }, 1000);

  void load();
}

if (!(window as unknown as { plusetAnswers?: boolean }).plusetAnswers) {
  (window as unknown as { plusetAnswers?: boolean }).plusetAnswers = true;
  start();
}
