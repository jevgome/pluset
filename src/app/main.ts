import 'katex/dist/katex.min.css';
import './styles.css';

import { normalizeSectionResponse } from '../core/normalize';
import { sectionLabel } from '../core/model';
import { parseSectionSpec, SectionSpecError, type SectionRequest } from '../core/sectionSpec';
import { deleteSection, listSections, loadSectionRaw, saveSection, type SavedSectionMeta } from '../core/storage';
import { AuthError, fetchSectionRaw, NotFoundError } from '../zybooks/api';
import { findZySession, type ZySession } from '../zybooks/session';
import { h, renderSection } from './render';
import { runSession } from './session';
import { mountAiSettings } from './aiSettingsPanel';
import { aiSectionPanel } from './aiSectionPanel';
import { runGeneration } from './aiGenerate';
import { mountCheatSheet, type CheatSheetPanel } from './cheatSheetPanel';
import { listAiProblems } from '../ai/store';
import type { SessionOrder } from '../core/progress';
import type { Section } from '../core/model';

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

const connectBtn = $<HTMLButtonElement>('connect');
const connectStatus = $('connect-status');
const bookInput = $<HTMLInputElement>('book');
const specInput = $<HTMLInputElement>('spec');
const fetchBtn = $<HTMLButtonElement>('fetch');
const fetchLog = $('fetch-log');
const libraryEl = $('library');
const importInput = $<HTMLInputElement>('import');
const viewer = $('viewer');
const orderSelect = $<HTMLSelectElement>('order');
const startPracticeBtn = $<HTMLButtonElement>('start-practice');
const includeAiBox = $<HTMLInputElement>('include-ai');
const generateAiBtn = $<HTMLButtonElement>('generate-ai');
const genCountSelect = $<HTMLSelectElement>('gen-count');
const cheatSheetBtn = $<HTMLButtonElement>('cheat-sheet');

let session: ZySession | null = null;
/** The open cheat sheet panel, told when the ticked sections change. */
let cheatSheet: { panel: CheatSheetPanel; el: HTMLElement } | null = null;
let openKey: string | null = null;
/** Sections ticked for practice (metaKey). */
const selected = new Set<string>();

const metaKey = (m: Pick<SavedSectionMeta, 'book' | 'chapter' | 'section'>) => `${m.book}:${m.chapter}.${m.section}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

function setStatus(el: HTMLElement, text: string, tone: 'ok' | 'error' | 'info' = 'info') {
  el.textContent = text;
  el.dataset.tone = tone;
}

function log(text: string, tone: 'ok' | 'error' | 'info' = 'info') {
  const li = h('li', {}, text);
  li.dataset.tone = tone;
  fetchLog.append(li);
  li.scrollIntoView({ block: 'nearest' });
}

/* ---------- Connect ---------- */

async function connect(): Promise<ZySession | null> {
  setStatus(connectStatus, 'Looking for a zyBooks tab…');
  try {
    session = await findZySession();
    if (session.book && !bookInput.value.trim()) bookInput.value = session.book;
    const tokenNote = session.tokens.length ? 'login found' : 'no login token found (will try cookies)';
    setStatus(connectStatus, `Connected${session.book ? ` to ${session.book}` : ''} · ${tokenNote}.`, 'ok');
    return session;
  } catch (e) {
    session = null;
    setStatus(connectStatus, errorMessage(e), 'error');
    return null;
  }
}

connectBtn.addEventListener('click', () => void connect());

/* ---------- Capture ---------- */

async function captureOne(book: string, chapter: number, section: number, tokens: string[]): Promise<SavedSectionMeta> {
  const raw = await fetchSectionRaw(book, chapter, section, tokens);
  const normalized = normalizeSectionResponse(raw, book); // validates the response shape
  const meta: SavedSectionMeta = {
    book,
    chapter: normalized.chapter || chapter,
    section: normalized.section || section,
    title: normalized.title,
    fetchedAt: new Date().toISOString(),
  };
  await saveSection(meta, raw);
  return meta;
}

async function capture() {
  const book = bookInput.value.trim();
  if (!book) {
    log('Enter the book code first (Connect fills it in automatically).', 'error');
    return;
  }
  let requests: SectionRequest[];
  try {
    requests = parseSectionSpec(specInput.value);
  } catch (e) {
    log(e instanceof SectionSpecError ? e.message : errorMessage(e), 'error');
    return;
  }
  if (requests.length === 0) {
    log('Enter one or more sections, like 8.5 or 8.1-8.4.', 'error');
    return;
  }

  fetchBtn.disabled = true;
  fetchLog.replaceChildren();
  try {
    const s = session ?? (await connect());
    const tokens = s?.tokens ?? [];
    let captured = 0;

    for (const req of requests) {
      if (req.kind === 'section') {
        try {
          const meta = await captureOne(book, req.chapter, req.section, tokens);
          log(`✓ ${sectionLabel(meta)} ${meta.title}`, 'ok');
          captured++;
        } catch (e) {
          log(`✗ ${req.chapter}.${req.section}: ${e instanceof NotFoundError ? 'no such section.' : errorMessage(e)}`, 'error');
          if (e instanceof AuthError) return;
        }
        await sleep(250);
        continue;
      }

      // Whole chapter: walk sections until zyBooks stops returning them.
      log(`Chapter ${req.chapter}…`);
      for (let sec = 1; sec <= 60; sec++) {
        try {
          const meta = await captureOne(book, req.chapter, sec, tokens);
          log(`✓ ${sectionLabel(meta)} ${meta.title}`, 'ok');
          captured++;
        } catch (e) {
          // After the first section, a failure most likely means we've passed the last section.
          if (sec > 1 && (e instanceof NotFoundError || e instanceof AuthError)) break;
          log(`✗ ${req.chapter}.${sec}: ${e instanceof NotFoundError ? 'chapter not found.' : errorMessage(e)}`, 'error');
          if (e instanceof AuthError) return;
          break;
        }
        await sleep(250);
      }
    }
    log(`Done: ${captured} section${captured === 1 ? '' : 's'} captured.`, captured ? 'ok' : 'error');
  } finally {
    fetchBtn.disabled = false;
    await refreshLibrary();
  }
}

fetchBtn.addEventListener('click', () => void capture());
specInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void capture();
});

/* ---------- Library ---------- */

async function refreshLibrary() {
  const items = await listSections();
  libraryEl.replaceChildren();
  if (items.length === 0) {
    libraryEl.append(h('p', { class: 'hint' }, 'No sections captured yet.'));
    return;
  }
  const byBook = new Map<string, SavedSectionMeta[]>();
  for (const m of items) byBook.set(m.book, [...(byBook.get(m.book) ?? []), m]);

  // Forget selections for sections that were deleted.
  const existing = new Set(items.map(metaKey));
  for (const k of selected) if (!existing.has(k)) selected.delete(k);
  updateStartButton();

  for (const [book, metas] of byBook) {
    const list = h('ul', { class: 'library__list' });
    const all = h('input', { type: 'checkbox', 'aria-label': `Select all sections of ${book}` }) as HTMLInputElement;
    const syncAll = () => {
      const n = metas.filter((m) => selected.has(metaKey(m))).length;
      all.checked = n === metas.length;
      all.indeterminate = n > 0 && n < metas.length;
    };
    const boxes: HTMLInputElement[] = [];
    all.addEventListener('change', () => {
      for (const m of metas) (all.checked ? selected.add(metaKey(m)) : selected.delete(metaKey(m)));
      for (const b of boxes) b.checked = all.checked;
      updateStartButton();
    });
    for (const m of metas) {
      const box = h('input', { type: 'checkbox', 'aria-label': `Practice ${sectionLabel(m)}` }) as HTMLInputElement;
      box.checked = selected.has(metaKey(m));
      box.addEventListener('change', () => {
        if (box.checked) selected.add(metaKey(m));
        else selected.delete(metaKey(m));
        syncAll();
        updateStartButton();
      });
      boxes.push(box);
      const open = h('button', { type: 'button', class: 'library__open' }, h('span', { class: 'library__num' }, sectionLabel(m)), ` ${m.title}`);
      if (metaKey(m) === openKey) open.setAttribute('aria-current', 'true');
      open.addEventListener('click', () => void openSection(m));
      const del = h('button', { type: 'button', class: 'library__delete', 'aria-label': `Delete ${sectionLabel(m)}`, title: 'Delete' }, '×');
      del.addEventListener('click', async () => {
        await deleteSection(m);
        if (metaKey(m) === openKey) showEmpty();
        await refreshLibrary();
      });
      list.append(h('li', {}, box, open, del));
    }
    syncAll();
    libraryEl.append(h('label', { class: 'library__book' }, all, book), list);
  }
}

function showEmpty() {
  openKey = null;
  viewer.replaceChildren(h('div', { class: 'empty' }, h('h2', {}, 'Nothing open yet'), h('p', {}, 'Pick a section from the library.')));
}

async function openSection(m: SavedSectionMeta) {
  const raw = await loadSectionRaw(m);
  if (!raw) {
    viewer.replaceChildren(h('p', { class: 'status', 'data-tone': 'error' }, 'That section is missing from storage.'));
    return;
  }
  try {
    const section = normalizeSectionResponse(raw, m.book);
    openKey = metaKey(m);
    viewer.replaceChildren(renderSection(section), aiSectionPanel(section));
    viewer.scrollTop = 0;
  } catch (e) {
    viewer.replaceChildren(h('p', { class: 'status', 'data-tone': 'error' }, `Couldn't read this section: ${errorMessage(e)}`));
  }
  await refreshLibrary();
}

/* ---------- Practice ---------- */

function updateStartButton() {
  startPracticeBtn.disabled = selected.size === 0;
  generateAiBtn.disabled = selected.size === 0;
  generateAiBtn.textContent = selected.size ? `Generate AI problems for ${selected.size}` : 'Generate AI problems';
  startPracticeBtn.textContent = selected.size ? `Practice ${selected.size} section${selected.size === 1 ? '' : 's'}` : 'Practice selected';
  if (cheatSheet?.el.isConnected) cheatSheet.panel.refreshSections();
}

async function selectedSections(): Promise<Section[]> {
  const metas = (await listSections()).filter((m) => selected.has(metaKey(m)));
  const sections: Section[] = [];
  for (const m of metas) {
    const raw = await loadSectionRaw(m);
    try {
      if (raw) sections.push(normalizeSectionResponse(raw, m.book));
    } catch {
      /* skip unreadable sections */
    }
  }
  return sections;
}

startPracticeBtn.addEventListener('click', async () => {
  const sections = await selectedSections();
  const ai = includeAiBox.checked
    ? (await Promise.all([...new Set(sections.map((s) => s.book))].map((b) => listAiProblems(b)))).flat()
    : [];
  openKey = null;
  await refreshLibrary();
  viewer.scrollTop = 0;
  await runSession(
    viewer,
    sections,
    orderSelect.value as SessionOrder,
    () => {
      showEmpty();
      void refreshLibrary();
    },
    ai,
  );
});

generateAiBtn.addEventListener('click', async () => {
  const sections = await selectedSections();
  const books = new Set(sections.map((s) => s.book));
  if (books.size > 1) {
    viewer.replaceChildren(h('p', { class: 'status', 'data-tone': 'error' }, 'Select sections from one book at a time to generate problems.'));
    return;
  }
  openKey = null;
  await refreshLibrary();
  viewer.scrollTop = 0;
  const panel = h('div', { class: 'zy-section' });
  viewer.replaceChildren(panel);
  generateAiBtn.disabled = true;
  try {
    await runGeneration(panel, sections, Number(genCountSelect.value));
  } finally {
    updateStartButton();
  }
});

/* ---------- Cheat sheet ---------- */

cheatSheetBtn.addEventListener('click', async () => {
  openKey = null;
  await refreshLibrary();
  viewer.scrollTop = 0;
  const el = h('div', { class: 'zy-section' });
  viewer.replaceChildren(el);
  cheatSheet = { el, panel: mountCheatSheet(el, selectedSections) };
});

/* ---------- Import ---------- */

importInput.addEventListener('change', async () => {
  const files = [...(importInput.files ?? [])];
  importInput.value = '';
  fetchLog.replaceChildren();
  const book = bookInput.value.trim() || 'imported';
  let last: SavedSectionMeta | null = null;
  for (const file of files) {
    try {
      const raw: unknown = JSON.parse(await file.text());
      const section = normalizeSectionResponse(raw, book);
      last = { book, chapter: section.chapter, section: section.section, title: section.title, fetchedAt: new Date().toISOString() };
      await saveSection(last, raw);
      log(`✓ Imported ${sectionLabel(last)} ${last.title} from ${file.name}`, 'ok');
    } catch (e) {
      log(`✗ ${file.name}: ${errorMessage(e)}`, 'error');
    }
  }
  await refreshLibrary();
  if (last) await openSection(last);
});

void refreshLibrary();
void mountAiSettings($('ai-settings'));
