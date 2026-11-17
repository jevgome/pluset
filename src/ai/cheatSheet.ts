// Cheat sheets: the AI condenses a study guide and/or captured book sections into a
// dense, mostly-equations reference (with each equation's assumptions and special
// cases) meant to fit on two printed pages. Saved locally so they can be reopened.

import type { Section } from '../core/model';
import { buildBookContext, estimateTokens } from './context';
import { AiError, costOf, type AiProvider, type ContentPart, type Usage } from './provider';
import { modelInfo, type AiSettings } from './settings';
import type { StudyGuide } from './studyGuide';

export type CheatItemKind = 'equation' | 'definition' | 'concept';

export interface CheatItem {
  kind: CheatItemKind;
  /** Short name, e.g. "Bernoulli equation" or "Reynolds number". */
  name: string;
  /** Display LaTeX without delimiters (equations); "" otherwise. */
  latex: string;
  /** Symbol meanings (equations) or the definition/concept itself. Inline math as \( … \). */
  text: string;
  /** Assumptions, conditions for using it, special cases, sign conventions. */
  conditions: string[];
  /** Where it comes from: a section label like "8.5", or "Guide". */
  source: string;
}

export interface CheatGroup {
  heading: string;
  items: CheatItem[];
}

export interface CheatSheetContent {
  title: string;
  groups: CheatGroup[];
  /** Topics the study guide lists that the materials don't explain. */
  missing_topics: string[];
}

export type Paper = 'letter' | 'a4';

export interface StoredCheatSheet {
  id: string;
  createdAt: string;
  model: string;
  guideName: string | null;
  sections: string[];
  focus: string;
  paper: Paper;
  columns: number;
  sheet: CheatSheetContent;
}

const ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'name', 'latex', 'text', 'conditions', 'source'],
  properties: {
    kind: { type: 'string', enum: ['equation', 'definition', 'concept'] },
    name: { type: 'string' },
    latex: { type: 'string' },
    text: { type: 'string' },
    conditions: { type: 'array', items: { type: 'string' } },
    source: { type: 'string' },
  },
};

export const CHEAT_SHEET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'groups', 'missing_topics'],
  properties: {
    title: { type: 'string' },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'items'],
        properties: { heading: { type: 'string' }, items: { type: 'array', items: ITEM_SCHEMA } },
      },
    },
    missing_topics: { type: 'array', items: { type: 'string' } },
  },
};

export const CHEAT_SHEET_SYSTEM = `You make exam cheat sheets for a student from their own course materials: a study guide from their course and/or sections of their zyBooks textbook (the reading, worked examples, and the book's activities with answers).

These materials are the only source you may use. Every equation, definition, concept, assumption, condition and special case you write must come from them, in the book's own notation and terminology. If something isn't in the materials, leave it out, even if you know it to be true.`;

export interface CheatSheetPlan {
  hasGuide: boolean;
  sections: string[];
  focus: string;
  columns: number;
}

export function cheatSheetInstructions(plan: CheatSheetPlan): string {
  const scope = plan.hasGuide
    ? `The study guide decides what to cover: include every topic it lists${plan.sections.length ? ', using the book sections for the equations, definitions and conditions behind each topic' : ''}. Skip book material the study guide doesn't ask for unless a listed topic needs it.`
    : `Cover the most important material of section${plan.sections.length > 1 ? 's' : ''} ${plan.sections.join(', ')}.`;
  const focus = plan.focus.trim() ? `\n\nThe student asked to cover only this: "${plan.focus.trim()}". Respect it.` : '';
  return `Make a cheat sheet that prints on at most two pages (${plan.columns} narrow columns per page, small font).

${scope}${focus}

What goes on it:
- Mainly equations: at least three quarters of the items. Every equation the student may need to solve problems on these topics, including the special-case and simplified forms the materials use (give those as their own short equation items right after the general form).
- For each equation, in conditions: the assumptions it requires and when it may or may not be used (e.g. steady, incompressible, along a streamline, frictionless, ideal gas, small angles, laminar only, Re < 2300), special cases and limits, and sign or unit conventions. Only conditions the materials state or clearly use.
- text for an equation: what the non-obvious symbols mean, with units when the materials give them, e.g. "\\(\\rho\\): density; \\(V\\): mean velocity". Leave out symbols any student knows (g, π) and leave text "" when nothing needs explaining.
- definitions and concepts only where the study guide lists them or the equations need them (key terms, dimensionless groups, rules of thumb, how to choose between equations). Keep each to one line or two.
- No examples, derivations, worked problems or filler. Write in terse fragments, not sentences.

Size: it must fit two pages, so be dense and selective. Aim for roughly 50 to 90 items and about 2,500 to 3,500 words in total including math. Prefer more equations with brief conditions over long explanations.

Organization: group items by topic in the order of the study guide (or the book), with short group headings. title: a short title for the sheet (course topic or exam name).

Fields:
- latex: the equation as LaTeX without delimiters (no $, \\[ or \\( around it). Use the materials' notation. For an equation with several forms, use aligned or put the forms side by side with \\quad. "" for definitions and concepts.
- name, text and conditions: plain text; inline math as \\( ... \\). No Markdown, no HTML.
- source: the section label the item comes from (e.g. "${plan.sections[0] ?? '8.5'}"), or "Guide" if it comes only from the study guide.
- missing_topics: topics the study guide lists that the materials don't explain well enough to put on the sheet (empty if none). Don't invent content for them.`;
}

export interface CheatSheetRequest {
  guide: StudyGuide | null;
  sections: Section[];
  focus: string;
  columns: number;
  settings: AiSettings;
  provider: AiProvider;
  onProgress: (message: string) => void;
  signal?: AbortSignal;
}

export interface CheatSheetResult {
  sheet: CheatSheetContent;
  model: string;
  usage: Usage;
  cost: number | null;
}

/** Can the configured model read PDFs and images directly? */
export function readsFiles(settings: AiSettings): boolean {
  return settings.provider === 'anthropic' && (modelInfo(settings, settings.generatorModel)?.vision ?? false);
}

/** The study guide as request content: the PDF/image itself when the model can read it, otherwise its text. */
export function guideContent(guide: StudyGuide, settings: AiSettings): ContentPart[] {
  const direct = readsFiles(settings);
  const label = `The student's study guide, "${guide.name}":`;
  if (direct && guide.pdf && (guide.pages ?? 0) <= 100) {
    return [{ type: 'text', text: label }, { type: 'document', mediaType: 'application/pdf', data: guide.pdf, title: guide.name }];
  }
  if (direct && guide.image) return [{ type: 'text', text: label }, { type: 'image', ...guide.image }];
  if (guide.text.trim()) return [{ type: 'text', text: `${label}\n<study_guide>\n${guide.text}\n</study_guide>` }];
  if (guide.image) throw new AiError('other', 'This AI model can only read text, and the study guide is an image. Use a PDF or Word file with text, or switch to the Claude API in AI settings.');
  throw new AiError('other', 'No text could be read from the study guide (it may be a scanned PDF). Use a file with selectable text, or switch to the Claude API in AI settings, which can read scanned pages.');
}

export async function generateCheatSheet(req: CheatSheetRequest): Promise<CheatSheetResult> {
  const { settings, provider, onProgress, signal } = req;
  if (!req.guide && req.sections.length === 0) throw new AiError('other', 'Add a study guide or tick some sections in the library first.');
  const labels = req.sections.map((s) => `${s.chapter}.${s.section}`);

  const content: ContentPart[] = [];
  if (req.guide) content.push(...guideContent(req.guide, settings));
  let bookTokens = 0;
  if (req.sections.length) {
    onProgress('Reading the sections…');
    const ctx = await buildBookContext(req.sections, null);
    bookTokens = estimateTokens(ctx.text);
    content.push({ type: 'text', text: `<book_material>\n${ctx.text}\n</book_material>`, cacheable: true });
  }
  if (signal?.aborted) throw new AiError('cancelled', 'Cancelled.');
  content.push({ type: 'text', text: cheatSheetInstructions({ hasGuide: Boolean(req.guide), sections: labels, focus: req.focus, columns: req.columns }) });

  const what = [req.guide && `the study guide`, labels.length && `section${labels.length > 1 ? 's' : ''} ${labels.join(', ')}`].filter(Boolean).join(' and ');
  const size = bookTokens ? ` (about ${Math.round(bookTokens / 1000)}k tokens of book material)` : '';
  onProgress(`Writing the cheat sheet from ${what} with ${modelInfo(settings, settings.generatorModel)?.label ?? settings.generatorModel}${size}…`);
  const res = await provider.requestJson({
    model: settings.generatorModel,
    system: CHEAT_SHEET_SYSTEM,
    content,
    schema: CHEAT_SHEET_SCHEMA,
    maxTokens: 32_000,
    effort: 'high',
    signal,
  });
  const sheet = cleanSheet(res.data);
  if (!sheet.groups.some((g) => g.items.length)) throw new AiError('bad_output', 'The AI returned an empty cheat sheet. Try again.');
  return { sheet, model: res.model, usage: res.usage, cost: costOf(res.usage, modelInfo(settings, settings.generatorModel)) };
}

const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '');

/** Coerces model output into a well-formed sheet (drops empty items and groups). */
export function cleanSheet(data: unknown): CheatSheetContent {
  const d = (data ?? {}) as Partial<Record<keyof CheatSheetContent, unknown>>;
  const groups = (Array.isArray(d.groups) ? d.groups : [])
    .map((g: Partial<Record<keyof CheatGroup, unknown>>): CheatGroup => ({
      heading: str(g?.heading),
      items: (Array.isArray(g?.items) ? g.items : [])
        .map((i: Partial<Record<keyof CheatItem, unknown>>): CheatItem => ({
          kind: i?.kind === 'definition' || i?.kind === 'concept' ? i.kind : 'equation',
          name: str(i?.name),
          latex: str(i?.latex).replace(/^\s*(\$\$?|\\\[|\\\()|(\$\$?|\\\]|\\\))\s*$/g, ''),
          text: str(i?.text),
          conditions: (Array.isArray(i?.conditions) ? i.conditions : []).map(str).filter(Boolean),
          source: str(i?.source),
        }))
        .filter((i) => i.name || i.latex || i.text),
    }))
    .filter((g) => g.items.length);
  return {
    title: str(d.title) || 'Cheat sheet',
    groups,
    missing_topics: (Array.isArray(d.missing_topics) ? d.missing_topics : []).map(str).filter(Boolean),
  };
}

/* ---------- Storage ---------- */

const KEY = 'cheatsheets';

export async function listCheatSheets(): Promise<StoredCheatSheet[]> {
  const got = await chrome.storage.local.get(KEY);
  return ((got[KEY] as StoredCheatSheet[] | undefined) ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

let chain: Promise<unknown> = Promise.resolve();
function update(fn: (list: StoredCheatSheet[]) => StoredCheatSheet[]): Promise<void> {
  const next = chain.then(async () => {
    const got = await chrome.storage.local.get(KEY);
    await chrome.storage.local.set({ [KEY]: fn((got[KEY] as StoredCheatSheet[] | undefined) ?? []) });
  });
  chain = next.catch(() => {});
  return next;
}

export const saveCheatSheet = (s: StoredCheatSheet) => update((list) => [...list.filter((x) => x.id !== s.id), s]);
export const deleteCheatSheet = (id: string) => update((list) => list.filter((x) => x.id !== id));
