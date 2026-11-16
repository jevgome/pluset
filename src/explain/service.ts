// Service-worker side of the on-page "Show answer" buttons: loads the section the
// student has open (from the library, or captures it from zyBooks if it isn't there
// yet) and lists the book's answers to its questions.

import { normalizeSectionResponse } from '../core/normalize';
import type { Section } from '../core/model';
import { listSections, loadSectionRaw, saveSection } from '../core/storage';
import { fetchSectionRaw } from '../zybooks/api';
import { scanLocalStorageForTokens } from '../zybooks/session';
import { explainItems } from './items';
import type { ExplainRequest, ItemsResponse, SectionRef } from './messages';

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

async function items(req: ExplainRequest, tabId: number | undefined): Promise<ItemsResponse> {
  const { section, fetchedAt } = await loadSection(req, tabId, req.refresh === true);
  return { ok: true, title: section.title, items: explainItems(section), fetchedAt };
}

export function registerExplainService(): void {
  chrome.runtime.onMessage.addListener((req: ExplainRequest, sender, sendResponse) => {
    if (req?.type !== 'pluset:explain:items') return false;
    items(req, sender.tab?.id).then(sendResponse, (e) => sendResponse({ ok: false, error: message(e) }));
    return true; // respond asynchronously
  });
}
