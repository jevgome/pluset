// "Explain" popup on zyBooks pages. Pick a question from the dropdown (or click
// "Pick on page" and then click the activity you're working on) to see the answer
// and the reasoning behind it. Nothing is typed into or submitted on the page.
//
// Built separately as one classic script (vite.content.config.ts): content scripts
// can't load ES module chunks, so this file imports only types and katex.

import katex from 'katex';
import type { ExplainItem } from '../explain/items';
import type { AskResponse, ExplainRequest, ItemsResponse, SectionRef } from '../explain/messages';

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
      const count = [...leaves].filter((l) => el.parentElement!.contains(l)).length;
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

/** The page element showing an item's activity (by its "8.5.3" number, else by position). */
function elementFor(item: ExplainItem): HTMLElement | null {
  const els = activityElements();
  const wantKind = item.kind === 'challenge' ? 'challenge' : 'participation';
  const byNumber = els.find((el) => {
    const info = activityInfo(el);
    return info.number === item.number && (info.kind === null || info.kind === wantKind);
  });
  return byNumber ?? els[item.activityIndex] ?? null;
}

function questionElements(activity: HTMLElement): HTMLElement[] {
  return [...activity.querySelectorAll<HTMLElement>('.question-set-question')];
}

/** What the page shows for an activity, including what's typed or chosen in its boxes. */
function pageTextFor(activity: HTMLElement | null, questionIndex: number | null): string {
  if (!activity) return '';
  const q = questionIndex !== null ? questionElements(activity)[questionIndex] : undefined;
  const root = q ?? activity;
  const text = root.innerText ?? root.textContent ?? '';
  const boxes = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[type=text], input:not([type]), textarea, select')]
    .map((b, i) => `box ${i + 1}: ${b instanceof HTMLSelectElement ? (b.selectedOptions[0]?.textContent ?? '').trim() : b.value || '(empty)'}`)
    .join('\n');
  return `${text.trim()}${boxes ? `\n\nAnswer boxes as the student currently has them:\n${boxes}` : ''}`;
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

const block = (title: string, text: string, cls = '') => el('div', `card ${cls}`, el('div', 'card__title', title), el('div', 'card__body', mathText(text)));

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.fab { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; border: 0; border-radius: 999px; padding: 10px 16px;
  background: #3b5bdb; color: #fff; font: 600 14px/1 system-ui, sans-serif; box-shadow: 0 4px 14px rgba(0,0,0,.25); cursor: pointer; }
.fab:hover { background: #364fc7; }
.panel { position: fixed; right: 20px; bottom: 70px; z-index: 2147483647; width: min(440px, calc(100vw - 32px)); max-height: min(78vh, 760px);
  display: flex; flex-direction: column; background: #fff; color: #1a1b1e; border: 1px solid #d0d4dc; border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,.22); font: 14px/1.5 system-ui, sans-serif; }
.panel[hidden] { display: none; }
.head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #e6e8ec; cursor: move; user-select: none; }
.head__title { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icon { border: 0; background: transparent; font-size: 16px; cursor: pointer; color: #495057; padding: 2px 6px; border-radius: 6px; }
.icon:hover { background: #f1f3f5; }
.controls { display: flex; gap: 6px; padding: 10px 12px 0; }
select { flex: 1; min-width: 0; font: inherit; padding: 6px; border: 1px solid #ced4da; border-radius: 8px; background: #fff; color: inherit; }
button.btn { font: 600 13px/1 system-ui, sans-serif; padding: 8px 12px; border-radius: 8px; border: 1px solid #3b5bdb; background: #3b5bdb; color: #fff; cursor: pointer; }
button.btn--ghost { background: #fff; color: #3b5bdb; }
button.btn:disabled { opacity: .55; cursor: default; }
.body { overflow: auto; padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 10px; }
.muted { color: #6c757d; font-size: 13px; }
.error { color: #c92a2a; font-size: 13px; white-space: pre-wrap; }
.card { border: 1px solid #e6e8ec; border-radius: 10px; padding: 8px 10px; }
.card__title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #6c757d; margin-bottom: 4px; }
.card__body { white-space: pre-wrap; overflow-wrap: anywhere; }
.card--answer { border-color: #b2f2bb; background: #ebfbee; }
.card--answer .card__body { font-weight: 600; }
.math--display { display: block; margin: 4px 0; overflow-x: auto; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
@media (prefers-color-scheme: dark) {
  .panel { background: #1f2125; color: #e9ecef; border-color: #373a40; }
  .head { border-color: #373a40; }
  .icon { color: #ced4da; } .icon:hover { background: #2c2e33; }
  select { background: #25262b; border-color: #495057; }
  .card { border-color: #373a40; }
  .card--answer { background: #1b3326; border-color: #2b8a3e; }
  button.btn--ghost { background: transparent; color: #91a7ff; border-color: #91a7ff; }
  .muted, .card__title { color: #adb5bd; }
}
`;

// ---------- popup ----------

const send = <T,>(req: ExplainRequest) => chrome.runtime.sendMessage(req) as Promise<T>;

function mount() {
  const host = document.createElement('div');
  host.id = 'pluset-explain';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.append(el('style', '', CSS));
  document.documentElement.append(host);

  const fab = el('button', 'fab', 'Explain');
  fab.title = 'Pluset: explain a question on this page';
  const title = el('div', 'head__title', 'Pluset — Explain');
  const refreshBtn = el('button', 'icon', '↻');
  refreshBtn.title = 'Recapture this section from zyBooks';
  const closeBtn = el('button', 'icon', '×');
  closeBtn.title = 'Close';
  const head = el('div', 'head', title, refreshBtn, closeBtn);
  const select = el('select');
  select.setAttribute('aria-label', 'Question');
  const pickBtn = el('button', 'btn btn--ghost', 'Pick on page');
  pickBtn.title = 'Then click the question you are working on';
  const body = el('div', 'body', el('p', 'muted', 'Loading…'));
  const panel = el('div', 'panel', head, el('div', 'controls', select, pickBtn), body);
  panel.hidden = true;
  shadow.append(fab, panel);

  let ref: SectionRef | null = null;
  let items: ExplainItem[] = [];
  let askSeq = 0;

  const status = (text: string, cls = 'muted') => body.replaceChildren(el('p', cls, text));

  async function load(refresh = false) {
    ref = sectionFromUrl(location.href);
    items = [];
    select.replaceChildren();
    if (!ref) {
      title.textContent = 'Pluset — Explain';
      status('Open a section of your zyBook to see its questions here.');
      return;
    }
    title.textContent = `Section ${ref.chapter}.${ref.section}`;
    status(refresh ? 'Recapturing this section…' : 'Loading questions…');
    let res: ItemsResponse;
    try {
      res = await send<ItemsResponse>({ type: 'pluset:explain:items', ...ref, refresh });
    } catch (e) {
      status(`Couldn’t reach Pluset: ${e instanceof Error ? e.message : e}\nIf you just reloaded the extension, reload this page.`, 'error');
      return;
    }
    if (!res.ok) return status(res.error, 'error');
    title.textContent = `${ref.chapter}.${ref.section} ${res.title}`;
    items = res.items;
    if (!items.length) return status('This section has no questions.');

    select.append(el('option', '', 'Choose a question…'));
    (select.firstChild as HTMLOptionElement).value = '';
    let group: HTMLOptGroupElement | null = null;
    let lastBlock = -1;
    for (const it of items) {
      if (it.blockId !== lastBlock) {
        group = el('optgroup');
        group.label = `${it.kind === 'challenge' ? 'Challenge' : 'Participation'} ${it.number}${it.caption ? ` — ${it.caption}` : ''}`;
        select.append(group);
        lastBlock = it.blockId;
      }
      const opt = el('option', '', it.label);
      opt.value = it.key;
      group!.append(opt);
    }
    status('Choose a question above, or click “Pick on page” and then click the question you’re working on.');
  }

  function show(item: ExplainItem) {
    select.value = item.key;
    const activity = elementFor(item);
    activity?.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const out: HTMLElement[] = [];
    if (item.prompt) out.push(block('Question', item.prompt));
    if (item.bookAnswer) out.push(block('Answer', item.bookAnswer, 'card--answer'));
    if (item.bookExplanation) out.push(block('Book’s explanation', item.bookExplanation));
    if (item.kind === 'challenge') {
      out.push(el('p', 'muted', 'Challenge values are randomized for you, so Claude reads the problem as your page shows it and solves that version.'));
    }

    const explainBtn = el('button', 'btn', item.kind === 'challenge' ? 'Solve my version' : 'Explain step by step');
    const result = el('div', 'body');
    result.style.padding = '0';
    explainBtn.addEventListener('click', async () => {
      const seq = ++askSeq;
      explainBtn.disabled = true;
      result.replaceChildren(el('p', 'muted', 'Asking Claude… this can take up to a minute.'));
      const pageText = pageTextFor(elementFor(item), item.kind === 'challenge' ? null : item.questionIndex);
      let res: AskResponse;
      try {
        res = await send<AskResponse>({ type: 'pluset:explain:ask', ...ref!, key: item.key, pageText });
      } catch (e) {
        res = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      if (seq !== askSeq) return;
      explainBtn.disabled = false;
      if (!res.ok) {
        result.replaceChildren(el('p', 'error', `${res.error}\n\nCheck AI settings in the Pluset app (and that "npm run helper" is running if you use Claude Code).`));
        return;
      }
      const x = res.explanation;
      result.replaceChildren(
        ...(item.bookAnswer ? [] : [block('Answer', x.answer, 'card--answer')]),
        block('Reasoning', x.reasoning),
        block('Key idea', x.key_idea),
        el('p', 'muted', `Explained by ${res.model}, from this section of your book. Double-check calculations before relying on them.`),
      );
      explainBtn.textContent = 'Explain again';
    });

    body.replaceChildren(...out, el('div', 'actions', explainBtn), result);
  }

  // Picking: the next click on the page selects the activity (and question) under it.
  let picking = false;
  function stopPicking() {
    picking = false;
    pickBtn.textContent = 'Pick on page';
    document.documentElement.style.cursor = '';
    document.removeEventListener('click', onPick, true);
  }
  function onPick(e: MouseEvent) {
    if (e.composedPath().includes(host)) return;
    e.preventDefault();
    e.stopPropagation();
    stopPicking();
    const target = e.target as Node;
    const els = activityElements();
    const activity = els.find((a) => a.contains(target));
    if (!activity) return status('That isn’t inside an activity. Click “Pick on page” and try again.', 'error');
    const info = activityInfo(activity);
    const index = els.indexOf(activity);
    const candidates = items.filter((i) =>
      info.number ? i.number === info.number && (info.kind === null || (i.kind === 'challenge') === (info.kind === 'challenge')) : i.activityIndex === index,
    );
    if (!candidates.length) return status('That activity has no questions to explain (it may be an animation).');
    const qIndex = questionElements(activity).findIndex((q) => q.contains(target));
    show(candidates.find((c) => c.questionIndex === qIndex) ?? candidates[0]!);
  }
  pickBtn.addEventListener('click', () => {
    if (picking) return stopPicking();
    picking = true;
    pickBtn.textContent = 'Cancel';
    document.documentElement.style.cursor = 'crosshair';
    setTimeout(() => document.addEventListener('click', onPick, true), 0);
  });

  select.addEventListener('change', () => {
    const item = items.find((i) => i.key === select.value);
    if (item) show(item);
  });
  fab.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    const now = sectionFromUrl(location.href);
    if (!panel.hidden && (!ref || !now || now.book !== ref.book || now.chapter !== ref.chapter || now.section !== ref.section)) void load();
  });
  closeBtn.addEventListener('click', () => {
    panel.hidden = true;
    stopPicking();
  });
  refreshBtn.addEventListener('click', () => void load(true));

  // Dragging the panel by its header.
  head.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = panel.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    const move = (ev: PointerEvent) => {
      panel.style.left = `${Math.max(0, Math.min(innerWidth - r.width, ev.clientX - dx))}px`;
      panel.style.top = `${Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy))}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });

  // zyBooks is a single-page app: follow section changes while the panel is open.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    stopPicking();
    if (!panel.hidden) void load();
    else ref = null;
  }, 1000);
}

if (!document.getElementById('pluset-explain')) mount();
