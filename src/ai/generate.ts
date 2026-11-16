// The generation pipeline:
//   1. build the book material from the chosen sections (+ figure images)
//   2. ask the generator model for problems (structured JSON)
//   3. validate locally: structure, running the numeric code, book quote present
//   4. ask the reviewer model to check grounding and answers (same cached prefix)
//   5. keep the problems that pass both

import type { ImageRef, Section } from '../core/model';
import { buildBookContext, estimateTokens, type BookContext, type BookImage, type ExampleMaker } from './context';
import { instantiateAiProblem } from './instance';
import { generationInstructions, reviewInstructions, SYSTEM_PROMPT } from './prompts';
import { AiError, costOf, emptyUsage, type AiProvider, type ContentPart, type Usage } from './provider';
import { GENERATION_SCHEMA, REVIEW_SCHEMA, type AiProblem, type GenerationOutput, type ReviewOutput } from './schema';
import { modelInfo, type AiSettings } from './settings';
import { newProblemId, type StoredAiProblem } from './store';
import { htmlToText } from './text';
import { validateProblem, type CodeRunner } from './validate';

export interface GenerateRequest {
  book: string;
  sections: Section[];
  count: number;
  existing: StoredAiProblem[];
  settings: AiSettings;
  provider: AiProvider;
  /** Runs AI-written Python (numeric problems). */
  runCode: CodeRunner;
  /** Generates one instance of a book challenge level, for the book material. */
  example: ExampleMaker | null;
  onProgress: (message: string) => void;
  signal?: AbortSignal;
}

export interface Rejected {
  problem: AiProblem;
  reasons: string[];
}

export interface GenerateResult {
  kept: StoredAiProblem[];
  rejected: Rejected[];
  usage: { generator: Usage; reviewer: Usage };
  /** Estimated cost in USD, or null if prices are unknown. */
  cost: number | null;
}

const MAX_IMAGES = 24;

function mixFor(count: number, hasChallenges: boolean) {
  const numeric = hasChallenges ? Math.round(count * 0.4) : 0;
  const shortAnswer = Math.round((count - numeric) * 0.3);
  return { numeric, shortAnswer, multipleChoice: count - numeric - shortAnswer };
}

async function fetchImage(img: BookImage, signal?: AbortSignal): Promise<ContentPart | null> {
  try {
    const res = await fetch(img.url, { signal });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
    const mediaType = (['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const).find((t) => t === type);
    if (!mediaType) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 3_500_000) return null;
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { type: 'image', mediaType, data: btoa(bin) };
  } catch {
    return null;
  }
}

/** The shared prefix of both requests: figure images, then the book material (cached). */
async function bookContent(ctx: BookContext, sendImages: boolean, onProgress: (m: string) => void, signal?: AbortSignal): Promise<ContentPart[]> {
  const parts: ContentPart[] = [];
  if (sendImages && ctx.images.length) {
    const chosen = ctx.images.slice(0, MAX_IMAGES);
    onProgress(`Downloading ${chosen.length} figure image${chosen.length === 1 ? '' : 's'}…`);
    const fetched = await Promise.all(chosen.map((img) => fetchImage(img, signal)));
    chosen.forEach((img, i) => {
      const part = fetched[i];
      if (!part) return;
      parts.push({ type: 'text', text: `[Image ${img.id}] ${img.label}${img.caption ? `: ${img.caption}` : ''}` }, part);
    });
  }
  parts.push({ type: 'text', text: `<book_material>\n${ctx.text}\n</book_material>`, cacheable: true });
  return parts;
}

function candidateText(p: AiProblem, index: number, sample: ProblemInstanceText): string {
  const lines = [`### Problem ${index} (${p.kind}, section ${p.section})`, `Based on: ${p.based_on}`, `Book quote: ${p.book_quote}`];
  if (p.figure_id) lines.push(`Uses figure: ${p.figure_id}`);
  lines.push(`Prompt: ${sample.prompt}`);
  if (p.kind === 'multiple_choice') {
    p.choices.forEach((c, i) => lines.push(`  ${String.fromCharCode(97 + i)}) ${c.text}${c.correct ? '  [marked correct]' : ''} - ${c.explanation}`));
  } else if (p.kind === 'short_answer') {
    lines.push(`Accepted answers: ${p.accepted_answers.join(' | ')}`);
  } else {
    lines.push(`Computed answers for this instance: ${sample.answers}`, `Python code:\n${p.python_code}`);
  }
  lines.push(`Solution: ${sample.solution}`);
  return lines.join('\n');
}

interface ProblemInstanceText {
  prompt: string;
  answers: string;
  solution: string;
}

function sampleText(p: AiProblem, vars: Record<string, string | string[]>): ProblemInstanceText {
  const inst = instantiateAiProblem(p, vars, null);
  const prompt = inst.parts
    .filter((x) => x.kind === 'text')
    .map((x) => (x.kind === 'text' ? htmlToText(x.html) : ''))
    .join(' ');
  const answers = p.answers.map((a) => `${a.variable} = ${String(vars[a.variable] ?? '?')}`).join(', ');
  return { prompt, answers, solution: htmlToText(inst.solutionHtml ?? '') };
}

export async function generateProblems(req: GenerateRequest): Promise<GenerateResult> {
  const { settings, provider, onProgress, signal } = req;
  const labels = req.sections.map((s) => `${s.chapter}.${s.section}`);
  const throwIfCancelled = () => {
    if (signal?.aborted) throw new AiError('cancelled', 'Cancelled.');
  };

  onProgress('Reading the sections…');
  const ctx = await buildBookContext(req.sections, req.example);
  throwIfCancelled();
  const sendImages = settings.sendImages && (modelInfo(settings, settings.generatorModel)?.vision ?? false);
  const prefix = await bookContent(ctx, sendImages, onProgress, signal);
  throwIfCancelled();

  // 1. Generate
  const hasChallenges = req.sections.some((s) => s.blocks.some((b) => b.kind === 'challenge'));
  const plan = {
    count: req.count,
    sections: labels,
    mix: mixFor(req.count, hasChallenges),
    existingPrompts: req.existing.map((e) => htmlToText(e.problem.prompt).slice(0, 200)),
  };
  onProgress(`Writing ${req.count} problems with ${modelInfo(settings, settings.generatorModel)?.label ?? settings.generatorModel} (about ${Math.round(estimateTokens(ctx.text) / 1000)}k tokens of book material)…`);
  const gen = await provider.requestJson({
    model: settings.generatorModel,
    system: SYSTEM_PROMPT,
    content: [...prefix, { type: 'text', text: generationInstructions(plan) }],
    schema: GENERATION_SCHEMA,
    maxTokens: 64_000,
    effort: 'high',
    signal,
  });
  const generated = ((gen.data as GenerationOutput).problems ?? []).slice(0, req.count * 2);
  throwIfCancelled();

  // 2. Validate locally
  onProgress(`Checking ${generated.length} problems (running their code, matching book quotes)…`);
  const rejected: Rejected[] = [];
  const candidates: { problem: AiProblem; sample: ProblemInstanceText }[] = [];
  for (const problem of generated) {
    const v = await validateProblem(problem, ctx.text, req.runCode, labels);
    if (v.ok) candidates.push({ problem, sample: sampleText(problem, v.sampleVars) });
    else rejected.push({ problem, reasons: v.reasons });
  }
  throwIfCancelled();

  // 3. Review
  let reviewUsage = emptyUsage();
  const kept: StoredAiProblem[] = [];
  if (candidates.length) {
    onProgress(`Reviewing ${candidates.length} problems against the book…`);
    const rev = await provider.requestJson({
      model: settings.reviewerModel,
      system: SYSTEM_PROMPT,
      content: [...prefix, { type: 'text', text: reviewInstructions(candidates.map((c, i) => candidateText(c.problem, i, c.sample)).join('\n\n')) }],
      schema: REVIEW_SCHEMA,
      maxTokens: 32_000,
      effort: 'medium',
      signal,
    });
    reviewUsage = rev.usage;
    const reviews = (rev.data as ReviewOutput).reviews ?? [];
    candidates.forEach((c, i) => {
      const r = reviews.find((x) => x.index === i);
      if (r?.keep && r.grounded && r.answer_correct) {
        kept.push({
          id: newProblemId(),
          book: req.book,
          section: c.problem.section,
          problem: c.problem,
          createdAt: new Date().toISOString(),
          generatorModel: gen.model,
          reviewerModel: rev.model,
          review: r,
        });
      } else {
        const reasons = !r
          ? ['the reviewer skipped it']
          : [
              !r.grounded && `not grounded in the book${r.outside_knowledge.length ? ` (uses: ${r.outside_knowledge.join('; ')})` : ''}`,
              !r.answer_correct && 'answer key judged incorrect',
              r.issues && r.issues,
            ].filter((x): x is string => Boolean(x));
        rejected.push({ problem: c.problem, reasons: reasons.length ? reasons : ['the reviewer rejected it'] });
      }
    });
  }

  const genCost = costOf(gen.usage, modelInfo(settings, settings.generatorModel));
  const revCost = costOf(reviewUsage, modelInfo(settings, settings.reviewerModel));
  return {
    kept,
    rejected,
    usage: { generator: gen.usage, reviewer: reviewUsage },
    cost: genCost === null || revCost === null ? null : genCost + revCost,
  };
}

/** Resolves a problem's figure_id to a book image (for display). */
export function figureFor(problem: AiProblem, sections: Section[]): ImageRef | null {
  if (!problem.figure_id) return null;
  for (const s of sections) {
    for (const b of s.blocks) {
      if (!('body' in b)) continue;
      const img = b.body.images.find((i) => i.id === problem.figure_id);
      if (img) return img;
    }
  }
  return null;
}

