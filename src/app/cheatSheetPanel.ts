// The cheat sheet maker: pick a study guide and/or sections, have the selected AI
// model write the sheet, then lay it out on at most two printed pages (shrinking the
// font as far as stays readable) and download it as a PDF or a standalone HTML file.

import katex from 'katex';
import sheetCss from './cheatSheet.css?inline';
import {
  deleteCheatSheet,
  generateCheatSheet,
  listCheatSheets,
  readsFiles,
  saveCheatSheet,
  type CheatItem,
  type Paper,
  type StoredCheatSheet,
} from '../ai/cheatSheet';
import { AiError } from '../ai/provider';
import { createProvider, loadSettings, modelInfo } from '../ai/settings';
import { readStudyGuide, STUDY_GUIDE_ACCEPT, toBase64, type StudyGuide } from '../ai/studyGuide';
import type { Section } from '../core/model';
import { sectionLabel } from '../core/model';
import { h, typeset } from './dom';

/** Font sizes tried when fitting, in points. Below 6 pt gets hard to read. */
const MAX_PT = 10;
const MIN_PT = 6;
const MAX_PAGES = 2;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

let cssInjected = false;
function injectCss() {
  if (cssInjected) return;
  cssInjected = true;
  document.head.append(h('style', {}, sheetCss));
}

export interface CheatSheetPanel {
  /** Call when the library selection changes. */
  refreshSections(): void;
}

export function mountCheatSheet(panel: HTMLElement, getSections: () => Promise<Section[]>): CheatSheetPanel {
  injectCss();
  let guide: StudyGuide | null = null;

  const fileInput = h('input', { type: 'file', accept: STUDY_GUIDE_ACCEPT }) as HTMLInputElement;
  const fileStatus = h('span', { class: 'zy-muted' });
  const sectionsNote = h('p', { class: 'hint' });
  const focusInput = h('input', { type: 'text', placeholder: 'Optional, e.g. "Exam 2 topics only" or "Part B of the guide"', spellcheck: 'false' }) as HTMLInputElement;
  const paperSelect = h('select', {}, h('option', { value: 'letter' }, 'Letter'), h('option', { value: 'a4' }, 'A4')) as HTMLSelectElement;
  const colsSelect = h('select', {}, ...[3, 4, 5].map((n) => h('option', { value: String(n), ...(n === 4 ? { selected: '' } : {}) }, `${n} columns`))) as HTMLSelectElement;
  const makeBtn = h('button', { type: 'button' }, 'Make cheat sheet') as HTMLButtonElement;
  const modelNote = h('p', { class: 'hint' });
  const steps = h('ol', { class: 'zy-gen__steps' });
  const status = h('div');
  const savedList = h('ul', { class: 'cs-saved' });
  const saved = h('details', { class: 'cs-saved-wrap' }, h('summary', {}, 'Saved cheat sheets'), savedList);
  const output = h('div', { class: 'cs-output' });

  panel.replaceChildren(
    h(
      'section',
      { class: 'zy-gen cs-panel' },
      h('h3', {}, 'Cheat sheet'),
      h('p', { class: 'hint' }, 'Up to two pages, mostly equations with the assumptions and special cases for using them, plus key definitions and concepts. Written by the AI model chosen in AI settings, only from your study guide and the sections you tick in the library.'),
      h('label', { class: 'field' }, h('span', {}, 'Study guide (PDF, Word, text or image)'), h('span', { class: 'cs-file' }, fileInput, fileStatus)),
      h('div', { class: 'field' }, h('span', {}, 'Book sections'), sectionsNote),
      h('label', { class: 'field' }, h('span', {}, 'Cover only'), focusInput),
      h('div', { class: 'cs-options' }, h('label', { class: 'field' }, h('span', {}, 'Paper'), paperSelect), h('label', { class: 'field' }, h('span', {}, 'Layout'), colsSelect)),
      h('div', { class: 'cs-actions' }, makeBtn),
      modelNote,
      steps,
      status,
      saved,
    ),
    output,
  );

  const refreshSections = async () => {
    const labels = (await getSections()).map(sectionLabel);
    sectionsNote.textContent = labels.length
      ? `${labels.join(', ')} (ticked in the library)`
      : 'None ticked. Tick sections in the library to give the AI the book’s equations and conditions.';
  };

  const refreshModel = async () => {
    const s = await loadSettings();
    const label = modelInfo(s, s.generatorModel)?.label ?? s.generatorModel;
    modelNote.textContent = `Model: ${label}${readsFiles(s) ? ' (reads PDFs and images directly)' : ' (reads the file’s text)'}. Change it in AI settings.`;
  };

  const refreshSaved = async () => {
    const list = await listCheatSheets();
    saved.hidden = list.length === 0;
    savedList.replaceChildren(
      ...list.map((s) => {
        const open = h('button', { type: 'button', class: 'library__open' }, s.sheet.title, h('span', { class: 'zy-muted' }, ` · ${new Date(s.createdAt).toLocaleDateString()}${s.sections.length ? ` · ${s.sections.join(', ')}` : ''}`));
        open.addEventListener('click', () => void showSheet(output, s));
        const del = h('button', { type: 'button', class: 'library__delete', title: 'Delete', 'aria-label': `Delete ${s.sheet.title}` }, '×');
        del.addEventListener('click', async () => {
          await deleteCheatSheet(s.id);
          if (output.dataset.sheet === s.id) output.replaceChildren();
          await refreshSaved();
        });
        return h('li', {}, open, del);
      }),
    );
  };

  fileInput.addEventListener('change', async () => {
    guide = null;
    const file = fileInput.files?.[0];
    if (!file) {
      fileStatus.textContent = '';
      return;
    }
    fileStatus.textContent = 'Reading…';
    try {
      guide = await readStudyGuide(file);
      const words = guide.text.split(/\s+/).filter(Boolean).length;
      fileStatus.textContent = [guide.pages && `${guide.pages} page${guide.pages === 1 ? '' : 's'}`, words ? `${words.toLocaleString()} words of text` : guide.image ? 'image' : 'no text found'].filter(Boolean).join(', ');
    } catch (e) {
      fileInput.value = '';
      fileStatus.textContent = errorMessage(e);
    }
  });

  makeBtn.addEventListener('click', async () => {
    const step = (text: string) => {
      for (const li of steps.querySelectorAll('li[data-active]')) li.removeAttribute('data-active');
      steps.append(h('li', { 'data-active': 'true' }, text));
    };
    const settle = () => {
      for (const li of steps.querySelectorAll('li[data-active]')) li.removeAttribute('data-active');
    };
    steps.replaceChildren();
    status.replaceChildren();
    const sections = await getSections();
    await refreshSections();
    if (!guide && sections.length === 0) {
      status.replaceChildren(h('p', { class: 'status', 'data-tone': 'error' }, 'Choose a study guide file or tick some sections in the library first.'));
      return;
    }
    const settings = await loadSettings();
    let provider;
    try {
      provider = createProvider(settings);
    } catch (e) {
      status.replaceChildren(h('p', { class: 'status', 'data-tone': 'error' }, `${errorMessage(e)} (AI settings are at the bottom of the sidebar.)`));
      return;
    }

    const controller = new AbortController();
    const cancel = h('button', { type: 'button', class: 'secondary' }, 'Cancel') as HTMLButtonElement;
    cancel.addEventListener('click', () => controller.abort());
    makeBtn.disabled = true;
    makeBtn.after(cancel);
    if (settings.provider === 'claude-code') step('Using Claude Code through the Pluset helper. This can take a few minutes.');
    try {
      const columns = Number(colsSelect.value);
      const res = await generateCheatSheet({ guide, sections, focus: focusInput.value, columns, settings, provider, onProgress: step, signal: controller.signal });
      settle();
      const stored: StoredCheatSheet = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        model: res.model,
        guideName: guide?.name ?? null,
        sections: sections.map(sectionLabel),
        focus: focusInput.value.trim(),
        paper: paperSelect.value as Paper,
        columns,
        sheet: res.sheet,
      };
      await saveCheatSheet(stored);
      await refreshSaved();
      const u = res.usage;
      const cost = settings.provider === 'claude-code' ? ' · counted toward your Claude plan’s usage' : res.cost === null ? '' : ` · about $${res.cost.toFixed(2)}`;
      const n = res.sheet.groups.reduce((a, g) => a + g.items.length, 0);
      status.replaceChildren(
        h('p', { class: 'status', 'data-tone': 'ok' }, `✓ Made a cheat sheet with ${n} items. It’s saved; you can reopen it below.`),
        h('p', { class: 'zy-muted' }, `${modelInfo(settings, res.model)?.label ?? res.model} · ${Math.round((u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens) / 1000)}k tokens in, ${Math.round(u.outputTokens / 1000)}k out${cost}`),
      );
      await showSheet(output, stored);
    } catch (e) {
      settle();
      const msg = e instanceof AiError && e.kind === 'cancelled' ? 'Cancelled.' : `Couldn’t make the cheat sheet: ${errorMessage(e)}`;
      status.replaceChildren(h('p', { class: 'status', 'data-tone': 'error' }, msg));
    } finally {
      cancel.remove();
      makeBtn.disabled = false;
    }
  });

  void refreshSections();
  void refreshModel();
  void refreshSaved();
  return { refreshSections: () => void refreshSections() };
}

/* ---------- Sheet view ---------- */

/** Typesets inline math, keeping punctuation right after a formula on the formula's line ("ρ:" not "ρ / :"). */
function typesetGlued(root: HTMLElement) {
  typeset(root);
  for (const katexEl of root.querySelectorAll<HTMLElement>('.katex')) {
    if (katexEl.closest('.cs-eq')) continue;
    // auto-render puts each formula in its own bare <span>.
    const parent = katexEl.parentElement;
    const k = parent && parent !== root && parent.tagName === 'SPAN' && !parent.className && parent.childNodes.length === 1 ? parent : katexEl;
    const next = k.nextSibling;
    const m = next?.nodeType === Node.TEXT_NODE ? /^[:;,.!?%)\]]+/.exec(next.textContent ?? '') : null;
    if (!next || !m) continue;
    const wrap = h('span', { class: 'cs-nobr' });
    k.replaceWith(wrap);
    wrap.append(k, m[0]);
    next.textContent = next.textContent!.slice(m[0].length);
  }
}

function itemEl(item: CheatItem, onRemove: (() => void) | null): HTMLElement {
  const el = h('div', { class: `cs-item cs-item--${item.kind}` });
  const name = h('span', { class: 'cs-name' }, item.name);
  const src = item.source ? h('span', { class: 'cs-src' }, item.source) : null;
  if (item.kind === 'equation') {
    el.append(h('div', {}, name, src));
    if (item.latex) el.append(eqEl(item.latex));
    if (item.text) el.append(h('div', { class: 'cs-text' }, item.text));
  } else {
    name.textContent = `${item.name}${item.text ? ': ' : ''}`;
    el.append(h('div', {}, name, item.text ? h('span', { class: 'cs-text' }, item.text) : null, src));
    if (item.latex) el.append(eqEl(item.latex));
  }
  if (item.conditions.length) el.append(h('ul', { class: 'cs-cond' }, ...item.conditions.map((c) => h('li', {}, c))));
  if (onRemove) {
    const rm = h('button', { type: 'button', class: 'cs-remove', title: 'Remove from the sheet', 'aria-label': `Remove ${item.name}` }, '×');
    rm.addEventListener('click', onRemove);
    el.append(rm);
  }
  typesetGlued(el);
  return el;
}

/** The unbreakable pieces that flow through the columns: group heading + first item, then each item. */
function sheetBlocks(s: StoredCheatSheet, onRemove: (g: number, i: number) => void): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  s.sheet.groups.forEach((group, gi) => {
    group.items.forEach((item, ii) => {
      const block = h('div', { class: 'cs-block' });
      if (ii === 0 && group.heading) {
        const head = h('div', { class: 'cs-group' }, group.heading);
        typeset(head);
        block.append(head);
      }
      block.append(itemEl(item, () => onRemove(gi, ii)));
      blocks.push(block);
    });
  });
  return blocks;
}

function newPage(s: StoredCheatSheet, first: boolean): { page: HTMLElement; cols: HTMLElement } {
  const cols = h('div', { class: 'cs-cols' });
  cols.style.setProperty('--cs-cols', String(s.columns));
  const page = h('div', { class: `cs-page cs-page--${s.paper}` });
  if (first) {
    const meta = [s.sections.length ? `zyBooks ${s.sections.join(', ')}` : '', s.guideName ?? ''].filter(Boolean).join(' · ');
    const head = h('div', { class: 'cs-head' }, h('span', { class: 'cs-title' }, s.sheet.title), h('span', { class: 'cs-meta' }, meta));
    typeset(head);
    page.append(head);
  }
  page.append(cols);
  return { page, cols };
}

/** Did `block` land outside the page's columns (in an overflow column to the right, or below)? */
function overflows(cols: HTMLElement, block: HTMLElement): boolean {
  const box = cols.getBoundingClientRect();
  return [...block.getClientRects()].some((r) => r.right > box.right + 1 || r.bottom > box.bottom + 1);
}

const renderEq = (el: HTMLElement, latex: string, wrap: boolean) =>
  // Inline mode lets KaTeX break the line at top-level = and + signs; \displaystyle keeps fractions full size.
  katex.render(wrap ? `\\displaystyle ${latex}` : latex, el, { displayMode: !wrap, throwOnError: false, strict: false, trust: false });

function eqEl(latex: string): HTMLElement {
  const eq = h('div', { class: 'cs-eq' });
  eq.dataset.latex = latex;
  renderEq(eq, latex, false);
  return eq;
}

/**
 * Makes display equations fit their column: one much wider than the column is
 * wrapped onto several lines; anything still too wide is scaled down.
 */
function fitEquations(root: HTMLElement) {
  const widthRatio = (eq: HTMLElement) => {
    const inner = eq.querySelector<HTMLElement>('.katex-display > .katex') ?? eq.querySelector<HTMLElement>('.katex');
    return inner ? eq.clientWidth / Math.max(1, inner.scrollWidth, ...[...inner.querySelectorAll<HTMLElement>('.katex-base, .base')].map((b) => b.offsetWidth)) : 1;
  };
  for (const eq of root.querySelectorAll<HTMLElement>('.cs-eq')) {
    const latex = eq.dataset.latex ?? '';
    eq.style.fontSize = '';
    eq.classList.remove('cs-eq--wrap');
    renderEq(eq, latex, false);
    let ratio = widthRatio(eq);
    if (ratio < 0.9) {
      eq.classList.add('cs-eq--wrap');
      renderEq(eq, latex, true);
      ratio = widthRatio(eq);
    }
    if (ratio < 1) eq.style.fontSize = `${Math.max(0.45, ratio * 0.98).toFixed(3)}em`;
  }
}

/** Flows `blocks` into pages at `pt` font size; returns the pages (may be more than MAX_PAGES). */
function layout(container: HTMLElement, s: StoredCheatSheet, blocks: HTMLElement[], pt: number): HTMLElement[] {
  container.style.setProperty('--cs-font', `${pt}pt`);
  container.replaceChildren();
  let current = newPage(s, true);
  container.append(current.page);
  // Equation widths depend only on the column width and font size: measure them in place first.
  current.cols.append(...blocks);
  fitEquations(current.cols);
  current.cols.replaceChildren();

  const pages = [current.page];
  for (const block of blocks) {
    current.cols.append(block);
    if (current.cols.childElementCount > 1 && overflows(current.cols, block)) {
      block.remove();
      current = newPage(s, false);
      container.append(current.page);
      pages.push(current.page);
      current.cols.append(block);
    }
  }
  return pages;
}

/** Largest font size (0.25 pt steps) at which the sheet fits MAX_PAGES pages. */
function fit(container: HTMLElement, s: StoredCheatSheet, blocks: HTMLElement[]): { pt: number; pages: HTMLElement[] } {
  const steps = Math.round((MAX_PT - MIN_PT) / 0.25);
  const at = (k: number) => MIN_PT + k * 0.25;
  if (layout(container, s, blocks, at(steps)).length <= MAX_PAGES) return { pt: at(steps), pages: [...container.children] as HTMLElement[] };
  let lo = 0;
  let hi = steps;
  if (layout(container, s, blocks, at(lo)).length > MAX_PAGES) return { pt: at(lo), pages: [...container.children] as HTMLElement[] };
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (layout(container, s, blocks, at(mid)).length <= MAX_PAGES) lo = mid;
    else hi = mid;
  }
  const pages = layout(container, s, blocks, at(lo));
  return { pt: at(lo), pages };
}

async function showSheet(output: HTMLElement, s: StoredCheatSheet) {
  output.dataset.sheet = s.id;
  const pdfBtn = h('button', { type: 'button' }, 'Download PDF') as HTMLButtonElement;
  const htmlBtn = h('button', { type: 'button', class: 'secondary' }, 'Download HTML') as HTMLButtonElement;
  const paperSelect = h('select', { 'aria-label': 'Paper' }, h('option', { value: 'letter' }, 'Letter'), h('option', { value: 'a4' }, 'A4')) as HTMLSelectElement;
  const colsSelect = h('select', { 'aria-label': 'Columns' }, ...[3, 4, 5].map((n) => h('option', { value: String(n) }, `${n} columns`))) as HTMLSelectElement;
  paperSelect.value = s.paper;
  colsSelect.value = String(s.columns);
  const fitNote = h('p', { class: 'status' });
  const missing = s.sheet.missing_topics.length
    ? h('p', { class: 'status', 'data-tone': 'error' }, `Not covered by your materials (capture those sections to include them): ${s.sheet.missing_topics.join('; ')}`)
    : null;
  const pagesEl = h('div', { class: 'cs-pages' });
  output.replaceChildren(
    h('div', { class: 'cs-toolbar' }, pdfBtn, htmlBtn, paperSelect, colsSelect),
    fitNote,
    missing ?? '',
    h('p', { class: 'hint' }, 'Download PDF opens the print dialog: choose “Save as PDF” as the destination. Hover over an item and click × to remove it; the rest re-flows to fit.'),
    h('div', { class: 'cs-preview' }, pagesEl),
  );
  if (missing) typeset(missing);

  let pt = MIN_PT;
  const render = async () => {
    const blocks = sheetBlocks(s, (gi, ii) => {
      s.sheet.groups[gi]!.items.splice(ii, 1);
      s.sheet.groups = s.sheet.groups.filter((g) => g.items.length);
      void saveCheatSheet(s).then(render);
    });
    await document.fonts.ready;
    const res = fit(pagesEl, s, blocks);
    pt = res.pt;
    const over = res.pages.slice(MAX_PAGES);
    for (const p of over) {
      p.classList.add('cs-page--over');
      p.prepend(h('span', { class: 'cs-over-label' }, 'Over the 2-page limit: not included in downloads'));
    }
    if (over.length) {
      const n = over.reduce((a, p) => a + p.querySelectorAll('.cs-item').length, 0);
      fitNote.dataset.tone = 'error';
      fitNote.textContent = `Too long for two pages even at ${MIN_PT} pt: ${n} item${n === 1 ? '' : 's'} past page ${MAX_PAGES} won’t be downloaded. Remove some items (×), or try 5 columns.`;
    } else {
      fitNote.dataset.tone = 'ok';
      fitNote.textContent = `Fits on ${res.pages.length} page${res.pages.length === 1 ? '' : 's'} at ${pt} pt.`;
    }
  };
  paperSelect.addEventListener('change', () => {
    s.paper = paperSelect.value as Paper;
    void saveCheatSheet(s).then(render);
  });
  colsSelect.addEventListener('change', () => {
    s.columns = Number(colsSelect.value);
    void saveCheatSheet(s).then(render);
  });

  const busy = async (btn: HTMLButtonElement, fn: () => Promise<void>) => {
    btn.disabled = true;
    try {
      await fn();
    } catch (e) {
      fitNote.dataset.tone = 'error';
      fitNote.textContent = `Download failed: ${errorMessage(e)}`;
    } finally {
      btn.disabled = false;
    }
  };
  htmlBtn.addEventListener('click', () =>
    void busy(htmlBtn, async () => downloadFile(`${fileBase(s)}.html`, new Blob([await standaloneHtml(s, pagesEl, pt)], { type: 'text/html' }))),
  );
  pdfBtn.addEventListener('click', () => void busy(pdfBtn, async () => printPdf(await standaloneHtml(s, pagesEl, pt))));

  await render();
}

/* ---------- Export ---------- */

const fileBase = (s: StoredCheatSheet) =>
  (s.sheet.title || 'cheat sheet')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'cheat-sheet';

function downloadFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

let katexCssPromise: Promise<string> | null = null;

/** KaTeX's CSS from the page's stylesheets, with its woff2 fonts inlined so the file works offline. */
function katexCss(): Promise<string> {
  katexCssPromise ??= (async () => {
    const out: string[] = [];
    for (const sheet of [...document.styleSheets]) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      const base = sheet.href ?? document.baseURI;
      for (const rule of [...rules]) {
        if (rule instanceof CSSFontFaceRule) {
          if (!/KaTeX/i.test(rule.style.getPropertyValue('font-family'))) continue;
          const m = /url\(\s*["']?([^"')]+\.woff2[^"')]*)["']?\s*\)/.exec(rule.cssText);
          if (!m) continue;
          const res = await fetch(new URL(m[1]!, base));
          if (!res.ok) continue;
          const data = toBase64(new Uint8Array(await res.arrayBuffer()));
          out.push(rule.cssText.replace(/src\s*:[^;]+;/, `src: url(data:font/woff2;base64,${data}) format("woff2");`));
        } else if (rule.cssText.includes('.katex')) {
          out.push(rule.cssText);
        }
      }
    }
    return out.join('\n');
  })();
  katexCssPromise.catch(() => (katexCssPromise = null));
  return katexCssPromise;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function standaloneHtml(s: StoredCheatSheet, pagesEl: HTMLElement, pt: number): Promise<string> {
  const clone = pagesEl.cloneNode(true) as HTMLElement;
  [...clone.children].slice(MAX_PAGES).forEach((p) => p.remove());
  clone.querySelectorAll('.cs-remove, .cs-over-label').forEach((el) => el.remove());
  clone.style.setProperty('--cs-font', `${pt}pt`);
  const size = s.paper === 'a4' ? 'A4' : 'letter';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(s.sheet.title)}</title>
<style>
${await katexCss()}
${sheetCss}
@page { size: ${size}; margin: 0; }
html, body { margin: 0; background: #fff; }
@media screen { body { background: #8a8a8a; padding: 18px 0; } .cs-page { box-shadow: 0 2px 10px rgba(0,0,0,.35); } }
@media print { .cs-pages { display: block; } .cs-page { break-after: page; } .cs-page:last-child { break-after: auto; } }
</style></head>
<body>${clone.outerHTML}</body></html>`;
}

/** Opens the print dialog for the sheet alone (choose "Save as PDF" as the destination). */
async function printPdf(html: string) {
  const frame = h('iframe', { title: 'Cheat sheet print', 'aria-hidden': 'true' }) as HTMLIFrameElement;
  Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: '900px', height: '1200px', border: '0' });
  const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }));
  frame.srcdoc = html;
  document.body.append(frame);
  await loaded;
  const win = frame.contentWindow;
  if (!win) throw new Error('Couldn’t open the print view.');
  await win.document.fonts.ready;
  win.addEventListener('afterprint', () => setTimeout(() => frame.remove(), 500), { once: true });
  setTimeout(() => frame.isConnected && frame.remove(), 10 * 60_000);
  win.focus();
  win.print();
}
