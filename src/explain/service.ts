// Service-worker side of the on-page "Explain" popup: loads the section the student
// has open (from the library, or captures it from zyBooks if it isn't there yet),
// lists its questions, and asks the configured AI provider to explain one.

import { buildBookContext } from '../ai/context';
import { createProvider, loadSettings } from '../ai/settings';
import { htmlToText } from '../ai/text';
import { normalizeSectionResponse } from '../core/normalize';
import type { Section } from '../core/model';
import { listSections, loadSectionRaw, saveSection } from '../core/storage';
import { normalizeLatex } from '../core/zymarkup';
import { fetchSectionRaw } from '../zybooks/api';
import { scanLocalStorageForTokens } from '../zybooks/session';
import { explainItems } from './items';
import type { AskResponse, ExplainRequest, ItemsResponse, SectionRef } from './messages';
import { EXPLAIN_SCHEMA, EXPLAIN_SYSTEM, explainInstructions, type Explanation } from './prompt';

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

/** The service worker can be stopped while it waits on a long request; API calls keep it alive. */
function keepAlive(): () => void {
  const timer = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  return () => clearInterval(timer);
}

async function items(req: Extract<ExplainRequest, { type: 'pluset:explain:items' }>, tabId: number | undefined): Promise<ItemsResponse> {
  const { section, fetchedAt } = await loadSection(req, tabId, req.refresh === true);
  return { ok: true, title: section.title, items: explainItems(section), fetchedAt };
}

async function ask(req: Extract<ExplainRequest, { type: 'pluset:explain:ask' }>, tabId: number | undefined): Promise<AskResponse> {
  const { section } = await loadSection(req, tabId, false);
  const item = explainItems(section).find((i) => i.key === req.key);
  if (!item) return { ok: false, error: 'That question isn’t in the captured section. Click ↻ to recapture it.' };

  const settings = await loadSettings();
  const provider = createProvider(settings);
  const context = await buildBookContext([section], null);

  // The section text has no generated instance of challenge levels here, so add the book's
  // worked-solution templates for this activity (values shown as ${name} placeholders).
  let method = '';
  const block = section.blocks.find((b) => b.id === item.blockId);
  if (block?.kind === 'challenge') {
    method = block.levels
      .map((l, i) => (l.explanationTemplate ? `Level ${i + 1} worked-solution template:\n${htmlToText(normalizeLatex(l.explanationTemplate))}` : ''))
      .filter(Boolean)
      .join('\n\n');
  }

  const stop = keepAlive();
  try {
    const res = await provider.requestJson({
      model: settings.generatorModel,
      system: EXPLAIN_SYSTEM,
      content: [
        { type: 'text', text: `BOOK MATERIAL\n\n${context.text}`, cacheable: true },
        { type: 'text', text: `${method ? `${method}\n\n` : ''}${explainInstructions(item, req.pageText.slice(0, 8000))}` },
      ],
      schema: EXPLAIN_SCHEMA,
      maxTokens: 6000,
      effort: 'medium',
    });
    return { ok: true, explanation: res.data as Explanation, model: res.model };
  } finally {
    stop();
  }
}

export function registerExplainService(): void {
  chrome.runtime.onMessage.addListener((req: ExplainRequest, sender, sendResponse) => {
    if (req?.type !== 'pluset:explain:items' && req?.type !== 'pluset:explain:ask') return false;
    const tabId = sender.tab?.id;
    const run = req.type === 'pluset:explain:items' ? items(req, tabId) : ask(req, tabId);
    run.then(sendResponse, (e) => sendResponse({ ok: false, error: message(e) }));
    return true; // respond asynchronously
  });
}
