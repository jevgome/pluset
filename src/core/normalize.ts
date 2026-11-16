// Converts raw zyBooks API responses into the normalized model in ./model.ts.
// The zyBooks format is undocumented, so every field is read defensively:
// missing or unexpected data degrades to empty values instead of throwing.

import type {
  Block,
  ChallengeBlock,
  ChallengeElement,
  ChallengeLevel,
  ImageRef,
  Rich,
  Section,
} from './model';

type Raw = any;

const ZYTOOLS_IMAGE_BASE = 'https://zytools.zybooks.com/zyAuthor';

export function zyImageUrl(subject: string, releaseId: number | string, imageId: string): string {
  return `${ZYTOOLS_IMAGE_BASE}/${encodeURIComponent(subject)}/${encodeURIComponent(String(releaseId))}/IMAGES/${encodeURIComponent(imageId)}`;
}

interface RefTarget {
  /** Display text: "(3)" for equations, "8.5.2" for figures and tables. */
  label: string;
  anchor: string;
}

interface Ctx {
  subject: string | null;
  releaseId: number | string | null;
  /** Reference ID -> display label for equations, figures and tables in this section. */
  refs: Map<string, RefTarget>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? v : []);
const px = (v: unknown): number => {
  const n = parseFloat(str(v));
  return Number.isFinite(n) ? n : 0;
};

const escapeAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function pieceTypes(piece: Raw): string[] {
  return arr(piece?.attributes).map((a) => str(a?.type));
}

function imageRef(ctx: Ctx, id: string, alt: string, subject?: unknown): ImageRef {
  const subj = str(subject) || ctx.subject;
  return {
    id,
    url: subj && ctx.releaseId !== null ? zyImageUrl(subj, ctx.releaseId, id) : null,
    alt,
  };
}

const anchorFor = (ref: string) => `ref-${ref.replace(/[^\w-]/g, '')}`;

/**
 * Assigns labels, in reading order, to everything in the section that text can refer to:
 * numbered equations "(n)" and labeled containers such as "Figure 8.5.2" / "Table 8.5.1".
 */
function collectReferenceTargets(resources: Raw[], chapter: number, section: number, ctx: Ctx) {
  let equations = 0;
  const perVariant = new Map<string, number>();
  for (const r of resources) {
    const payload = r?.payload ?? {};
    const variant = str(payload.name);
    const ref = str(payload.ref);
    if (str(r?.type) === 'container' && ref && NUMBERED_CONTAINERS.has(variant) && !ctx.refs.has(ref)) {
      const n = (perVariant.get(variant) ?? 0) + 1;
      perVariant.set(variant, n);
      ctx.refs.set(ref, { label: `${chapter}.${section}.${n}`, anchor: anchorFor(ref) });
    }
    for (const piece of arr(payload.html)) {
      if (!pieceTypes(piece).includes('inline-enum')) continue;
      const eq = str(piece.ref) || str(piece.enumid);
      if (eq && !ctx.refs.has(eq)) ctx.refs.set(eq, { label: `(${++equations})`, anchor: anchorFor(eq) });
    }
  }
}

/** Container kinds that zyBooks numbers and that text refers to ("see Fig. 8.5.2"). */
const NUMBERED_CONTAINERS = new Set(['Figure', 'Table', 'Example']);

/**
 * zyBooks rich text is either a plain string or an array of "pieces":
 * html fragments, images, numbered equations (inline-enum) and references to them.
 */
export function richText(pieces: unknown, ctx: Ctx): Rich {
  if (typeof pieces === 'string') return { html: pieces, images: [] };
  const images: ImageRef[] = [];
  let html = '';
  for (const piece of arr(pieces)) {
    const attrs = arr(piece?.attributes);
    const type = str(attrs[0]?.type);
    if (type === 'html') {
      html += str(piece.text);
    } else if (type === 'image') {
      const a = attrs[0];
      const ids = arr(a.image_ids).map(str).filter(Boolean);
      const id = str(a.filename) || ids[0] || '';
      if (!id) continue;
      const img = imageRef(ctx, id, str(a.alt_text), a.subject);
      images.push(img);
      const width = str(a.width);
      html += `<img data-zy-image="${escapeAttr(id)}"${img.url ? ` src="${escapeAttr(img.url)}"` : ''} alt="${escapeAttr(img.alt)}"${width ? ` width="${escapeAttr(width)}"` : ''}>`;
    } else if (type === 'inline-enum') {
      const target = ctx.refs.get(str(piece.ref) || str(piece.enumid));
      html += `<div class="zy-eq"${target ? ` id="${target.anchor}"` : ''}>${str(piece.text)}${target ? `<span class="zy-eq-num">${target.label}</span>` : ''}</div>`;
    } else if (type === 'reference') {
      const target = ctx.refs.get(str(piece.reference));
      html += target
        ? `<a class="zy-ref" href="#${target.anchor}">${target.label}</a>`
        : `<span class="zy-ref zy-ref--external">[in another section]</span>`;
    } else if (typeof piece?.text === 'string') {
      html += piece.text;
    }
  }
  return { html, images };
}

function normalizeChallengeElement(el: Raw): ChallengeElement {
  const imageId = strOrNull(el.imageID);
  return {
    id: String(el.id ?? ''),
    type: str(el.type),
    text: strOrNull(el.text),
    ariaLabel: strOrNull(el.ariaLabel),
    placeholder: strOrNull(el.placeholder),
    correctAnswers: arr(el.correctAnswers).map(String),
    assessmentMethod: strOrNull(el.assessmentMethod),
    assessmentProperties: el.assessmentProperties && typeof el.assessmentProperties === 'object' ? el.assessmentProperties : {},
    options: arr(el.options),
    optionOrdering: strOrNull(el.optionOrderingMethod),
    tableData: el.tableData ?? null,
    // Challenge images use a different ID scheme (not zytools UUIDs); URL resolution is TODO.
    image: imageId ? { id: imageId, url: null, alt: str(el.alt) } : null,
    top: px(el.style?.top),
    left: px(el.style?.left),
    row: 0,
  };
}

/**
 * zyBooks lays challenge elements out at absolute pixel positions. Elements on one
 * visual line ("Δp =" [input] "lb/ft²") have slightly different `top` values, so group
 * elements whose tops are close into rows, then order each row left to right.
 */
const ROW_TOLERANCE_PX = 20;
export function assignRows(elements: ChallengeElement[]): ChallengeElement[] {
  const byTop = [...elements].sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: ChallengeElement[][] = [];
  let rowTop = -Infinity;
  for (const el of byTop) {
    if (rows.length === 0 || el.top - rowTop > ROW_TOLERANCE_PX) {
      rows.push([]);
      rowTop = el.top;
    }
    rows[rows.length - 1]!.push(el);
  }
  return rows.flatMap((row, i) => row.sort((a, b) => a.left - b.left).map((el) => ({ ...el, row: i })));
}

/** Normalizes a ProgressionPlayer payload (challenge activities). */
export function normalizeChallengePayload(
  payload: Raw,
  base: { id: number; caption: string; activityType: string | null },
  ctx: Ctx,
): ChallengeBlock {
  const prog = payload?.options?.progression ?? {};
  const baseElements = new Map<string, Raw>();
  for (const el of arr(prog.elements)) baseElements.set(String(el.id), el);

  const levels: ChallengeLevel[] = arr(prog.levels).map((level, i) => {
    const used = new Set(arr(level.usedElements).map(String));
    const questions = arr(level.questions).map((q, qi) => {
      // A question shows the level's used elements, with per-question overrides (elementVariants).
      const merged = new Map<string, Raw>();
      for (const id of used) {
        const b = baseElements.get(id);
        if (b) merged.set(id, { ...b });
      }
      for (const variant of [...arr(level.elementVariants), ...arr(q.elementVariants)]) {
        const id = String(variant.id);
        merged.set(id, { ...(merged.get(id) ?? baseElements.get(id) ?? {}), ...variant });
      }
      const elements = assignRows([...merged.values()].map(normalizeChallengeElement));
      return { name: str(q.name) || `Question ${qi + 1}`, elements };
    });
    return {
      name: str(level.name) || `Level ${i + 1}`,
      code: str(level.code),
      explanationTemplate: strOrNull(level.explanation),
      questions,
    };
  });

  return {
    kind: 'challenge',
    ...base,
    tool: str(payload?.tool),
    sharedCode: str(prog.code),
    levels,
  };
}

function normalizeResource(r: Raw, ctx: Ctx): Block {
  const payload = r?.payload ?? {};
  const base = {
    id: Number(r?.id) || 0,
    caption: str(r?.caption),
    activityType: strOrNull(r?.activity_type),
  };
  const type = str(r?.type);
  const tool = strOrNull(payload.tool);

  if (type === 'html') return { kind: 'text', ...base, body: richText(payload.html, ctx) };
  if (type === 'container') {
    const target = ctx.refs.get(str(payload.ref));
    return {
      kind: 'container',
      ...base,
      variant: str(payload.name) || 'Container',
      label: target?.label ?? null,
      anchor: target?.anchor ?? null,
      body: richText(payload.html, ctx),
    };
  }
  if (type === 'multiple_choice') {
    return {
      kind: 'multipleChoice',
      ...base,
      questions: arr(payload.questions).map((q) => ({
        prompt: richText(q.text, ctx),
        choices: arr(q.choices).map((c) => ({
          label: richText(c.label, ctx),
          correct: c.correct === true,
          explanation: richText(c.explanation, ctx),
        })),
      })),
    };
  }
  if (type === 'short_answer') {
    return {
      kind: 'shortAnswer',
      ...base,
      questions: arr(payload.questions).map((q) => ({
        prompt: richText(q.text, ctx),
        answers: arr(q.answers).map(String),
        preferred: strOrNull(q.preferred),
        hint: strOrNull(q.hint),
        textAfter: strOrNull(q.text_after),
        explanation: richText(q.explanation, ctx),
        caseSensitive: q.obey_case === true,
      })),
    };
  }
  if (tool === 'zyAnimator') {
    return { kind: 'animation', ...base, description: str(payload.alt_text).trim() };
  }
  if (tool === 'defnMatch') {
    return {
      kind: 'definitionMatch',
      ...base,
      terms: arr(payload.options?.terms).map((t) => ({
        term: str(t.term),
        definition: str(t.definition),
        explanation: str(t.explanation),
      })),
    };
  }
  if (tool && tool.startsWith('ProgressionPlayer')) return normalizeChallengePayload(payload, base, ctx);
  return { kind: 'unknown', ...base, resourceType: type, tool };
}

function findSubject(resources: Raw[]): string | null {
  for (const r of resources) {
    const s = strOrNull(r?.payload?.subject);
    if (s) return s;
  }
  return null;
}

/** Normalizes a response from GET /v1/zybook/{book}/chapter/{ch}/section/{sec}. */
export function normalizeSectionResponse(raw: Raw, book: string): Section {
  const s = raw?.section;
  if (!raw || raw.success !== true || !s || !Array.isArray(s.content_resources)) {
    throw new Error('This is not a zyBooks section response.');
  }
  const resources: Raw[] = s.content_resources;
  const chapter = Number(s.canonical_chapter_number) || 0;
  const section = Number(s.canonical_section_number) || 0;
  const ctx: Ctx = {
    subject: findSubject(resources),
    releaseId: s.release_id ?? null,
    refs: new Map(),
  };
  collectReferenceTargets(resources, chapter, section, ctx);
  return {
    book,
    chapter,
    section,
    title: str(s.custom_title) || str(s.title),
    subject: ctx.subject,
    blocks: resources.map((r) => normalizeResource(r, { ...ctx, releaseId: r?.release_id ?? ctx.releaseId })),
  };
}

/** Exposed for tests and for the bulk activity_data endpoint, which shares payload formats. */
export function normalizeActivityResource(meta: Raw, releaseId: number | string | null = null): Block {
  const ctx: Ctx = { subject: strOrNull(meta?.payload?.subject), releaseId, refs: new Map() };
  return normalizeResource(
    {
      id: meta?.content_resource_id,
      caption: meta?.caption,
      activity_type: meta?.activity_type,
      type: meta?.resource_type,
      payload: meta?.payload,
    },
    ctx,
  );
}
