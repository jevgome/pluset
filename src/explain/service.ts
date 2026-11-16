// Service-worker side of the on-page "Show answer" buttons: loads the section the
// student has open (from the library, or captures it from zyBooks if it isn't there
// yet) and lists the book's answers to its questions. Challenge activities are solved
// on request by recreating the student's randomized version from the page's text
// (the Python search runs in an offscreen document, since service workers can't host it).

import { normalizeSectionResponse } from '../core/normalize';
import type { Section } from '../core/model';
import { listSections, loadSectionRaw, saveSection } from '../core/storage';
import { fetchSectionRaw } from '../zybooks/api';
import { scanLocalStorageForTokens } from '../zybooks/session';
import { matchInput } from '../engine/match';
import type { MatchResult } from '../engine/runtime';
import type { OffscreenMatchRequest } from '../offscreen/main';
import { challengeRefs, explainItems } from './items';
import type { ExplainRequest, ItemsResponse, SectionRef, SolveResponse } from './messages';
import { solvedLevels } from './solve';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function tokensFromTab(tabId: number | undefined): Promise<string[]> {
  if (tabId === undefined) return [];
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: scanLocalStorageForTokens });
  const found = (result?.result ?? []) as { path: string; value: string }[];
  found.sort((a, b) => Number(/auth_token/i.test(b.path)) - Number(/auth_token/i.test(a.path)));
  return [...new Set(found.map((f) => f.value))];
}

async function loadSection(ref: SectionRef, tabId: number | undefined, refresh: boolean): Promise<{ section: Section; fetchedAt: string | null }> {
  if (!refresh) {
    const raw = await loadSectionRaw(ref);
    if (raw) {
      const meta = (await listSections()).find((m) => m.book === ref.book && m.chapter === ref.chapter && m.section === ref.section);
      return { section: normalizeSectionResponse(raw, ref.book), fetchedAt: meta?.fetchedAt ?? null };
    }
  }
  // Not captured yet: capture it now with the student's zyBooks login, and keep it in the library.
  const raw = await fetchSectionRaw(ref.book, ref.chapter, ref.section, await tokensFromTab(tabId));
  const section = normalizeSectionResponse(raw, ref.book);
  const fetchedAt = new Date().toISOString();
  await saveSection(
    { book: ref.book, chapter: section.chapter || ref.chapter, section: section.section || ref.section, title: section.title, fetchedAt },
    raw,
  );
  return { section, fetchedAt };
}

async function items(req: Extract<ExplainRequest, { type: 'pluset:explain:items' }>, tabId: number | undefined): Promise<ItemsResponse> {
  const { section, fetchedAt } = await loadSection(req, tabId, req.refresh === true);
  return { ok: true, title: section.title, items: explainItems(section), challenges: challengeRefs(section), fetchedAt };
}

let offscreen: Promise<void> | null = null;

function ensureOffscreen(): Promise<void> {
  offscreen ??= (async () => {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Runs the book’s Python code for challenge activities in a worker.',
    });
  })().catch((e: unknown) => {
    offscreen = null;
    throw e;
  });
  return offscreen;
}

/** The service worker can be stopped while it waits on a long request; API calls keep it alive. */
function keepAlive(): () => void {
  const timer = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  return () => clearInterval(timer);
}

async function solve(req: Extract<ExplainRequest, { type: 'pluset:explain:solve' }>, tabId: number | undefined): Promise<SolveResponse> {
  const { section } = await loadSection(req, tabId, false);
  const block = section.blocks.find((b) => b.id === req.blockId);
  if (block?.kind !== 'challenge') return { ok: false, error: 'That activity isn’t in the captured section. Recapture it in the Pluset app.' };
  const pageText = req.pageText.slice(0, 30_000);
  const requests = block.levels.map((_, i) => matchInput(block, i, pageText));
  const stop = keepAlive();
  try {
    await ensureOffscreen();
    const msg: OffscreenMatchRequest = { type: 'pluset:offscreen:match', requests };
    const results = (await chrome.runtime.sendMessage(msg)) as MatchResult[] | undefined;
    if (!results) throw new Error('The Python engine didn’t answer.');
    return solvedLevels(block, requests, results);
  } finally {
    stop();
  }
}

export function registerExplainService(): void {
  chrome.runtime.onMessage.addListener((req: ExplainRequest, sender, sendResponse) => {
    if (req?.type !== 'pluset:explain:items' && req?.type !== 'pluset:explain:solve') return false;
    const tabId = sender.tab?.id;
    const run = req.type === 'pluset:explain:items' ? items(req, tabId) : solve(req, tabId);
    run.then(sendResponse, (e) => sendResponse({ ok: false, error: message(e) }));
    return true; // respond asynchronously
  });
}
