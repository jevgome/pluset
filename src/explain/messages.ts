// Messages between the zyBooks-page popup (content script) and the service worker.
// Types only, so the content script bundle stays free of app code.

import type { ExplainItem } from './items';
import type { Explanation } from './prompt';

export interface SectionRef {
  book: string;
  chapter: number;
  section: number;
}

export type ExplainRequest =
  | ({ type: 'pluset:explain:items'; refresh?: boolean } & SectionRef)
  | ({ type: 'pluset:explain:ask'; key: string; pageText: string } & SectionRef);

export type ItemsResponse =
  | { ok: true; title: string; items: ExplainItem[]; fetchedAt: string | null }
  | { ok: false; error: string };

export type AskResponse = { ok: true; explanation: Explanation; model: string } | { ok: false; error: string };
