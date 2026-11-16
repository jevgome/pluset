// Messages between the zyBooks-page "Show answer" buttons (content script) and the
// service worker. Types only, so the content script bundle stays free of app code.

import type { ExplainItem } from './items';

export interface SectionRef {
  book: string;
  chapter: number;
  section: number;
}

export type ExplainRequest = { type: 'pluset:explain:items'; refresh?: boolean } & SectionRef;

export type ItemsResponse =
  | { ok: true; title: string; items: ExplainItem[]; fetchedAt: string | null }
  | { ok: false; error: string };
