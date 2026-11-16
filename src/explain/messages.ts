// Messages between the zyBooks-page "Show answer" buttons (content script) and the
// service worker. Types only, so the content script bundle stays free of app code.

import type { ExplainItem } from './items';

export interface SectionRef {
  book: string;
  chapter: number;
  section: number;
}

export type ExplainRequest =
  | ({ type: 'pluset:explain:items'; refresh?: boolean } & SectionRef)
  | ({ type: 'pluset:explain:solve'; blockId: number; pageText: string } & SectionRef);

/** A challenge activity of the section (randomized per student, so solved from the page). */
export interface ChallengeRef {
  blockId: number;
  activityIndex: number;
  /** Challenge number as zyBooks shows it, e.g. "8.5.1". */
  number: string;
}

export type ItemsResponse =
  | { ok: true; title: string; items: ExplainItem[]; challenges: ChallengeRef[]; fetchedAt: string | null }
  | { ok: false; error: string };

export interface SolvedLevel {
  name: string;
  /** The page's numbers matched this version exactly (otherwise: closest version found). */
  exact: boolean;
  /** Other versions match the page equally well but have different answers. */
  ambiguous: boolean;
  /** The values read off the page, e.g. [["x", "4"], ["y", "1"]], so the student can check them. */
  shown: [string, string][];
  answers: { label: string; value: string }[];
  /** The book's worked solution for this version (plain text, LaTeX in \( \)). */
  solution: string | null;
}

export type SolveResponse = { ok: true; levels: SolvedLevel[] } | { ok: false; error: string };
