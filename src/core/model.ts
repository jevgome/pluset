// The normalized, zyBooks-independent shape of a captured section.
// Everything downstream (viewer, generators, AI prompts) works from these types.
//
// "html" fields hold the book's HTML as-is (unsanitized) with LaTeX delimiters
// \( \), \[ \] and $$ $$ left in place. Renderers must sanitize before display.

export interface ImageRef {
  id: string;
  /** Direct URL, or null when we don't know how to resolve this ID yet. */
  url: string | null;
  alt: string;
}

export interface Rich {
  html: string;
  images: ImageRef[];
}

interface BlockBase {
  /** zyBooks content resource ID. */
  id: number;
  caption: string;
  /** 'participation' | 'challenge' | null for reading content. */
  activityType: string | null;
}

export interface TextBlock extends BlockBase {
  kind: 'text';
  body: Rich;
}

export interface ContainerBlock extends BlockBase {
  kind: 'container';
  /** zyBooks container name: 'Figure', 'Table', 'Note', 'Example', 'Video', 'Learning outcomes', ... */
  variant: string;
  /** Number like "8.5.2" for figures, tables and examples; null for unnumbered containers. */
  label: string | null;
  /** Element ID that in-text references link to. */
  anchor: string | null;
  body: Rich;
}

export interface MultipleChoiceQuestion {
  prompt: Rich;
  choices: { label: Rich; correct: boolean; explanation: Rich }[];
}

export interface MultipleChoiceBlock extends BlockBase {
  kind: 'multipleChoice';
  questions: MultipleChoiceQuestion[];
}

export interface ShortAnswerQuestion {
  prompt: Rich;
  answers: string[];
  preferred: string | null;
  hint: string | null;
  textAfter: string | null;
  explanation: Rich;
  caseSensitive: boolean;
}

export interface ShortAnswerBlock extends BlockBase {
  kind: 'shortAnswer';
  questions: ShortAnswerQuestion[];
}

export interface AnimationBlock extends BlockBase {
  kind: 'animation';
  /** zyBooks' step-by-step text description of the animation. */
  description: string;
}

export interface DefinitionMatchBlock extends BlockBase {
  kind: 'definitionMatch';
  terms: { term: string; definition: string; explanation: string }[];
}

export interface ChallengeElement {
  id: string;
  /** 'text' | 'shortanswer' | 'dropdown' | 'image' | 'table' | other zyBooks element types. */
  type: string;
  /** Text content; may contain ${var} placeholders filled in by the level's code. */
  text: string | null;
  ariaLabel: string | null;
  placeholder: string | null;
  /** Templates like "${p_1_display}". */
  correctAnswers: string[];
  assessmentMethod: string | null;
  assessmentProperties: Record<string, unknown>;
  options: unknown[];
  /** Dropdown option order: 'sort', 'reverse-sort', or null to keep the book's order. */
  optionOrdering: string | null;
  tableData: unknown;
  image: ImageRef | null;
  /** Layout position in the zyBooks canvas, used for reading order. */
  top: number;
  left: number;
  /** Visual line this element sits on (elements on one line render side by side). */
  row: number;
}

export interface ChallengeQuestion {
  name: string;
  /** Elements shown for this question, in reading order. */
  elements: ChallengeElement[];
}

export interface ChallengeLevel {
  name: string;
  /** Python generator code for this level (runs after the shared code). */
  code: string;
  /** Solution template with ${var} placeholders. */
  explanationTemplate: string | null;
  questions: ChallengeQuestion[];
}

export interface ChallengeBlock extends BlockBase {
  kind: 'challenge';
  tool: string;
  /** Python code run before every level. */
  sharedCode: string;
  levels: ChallengeLevel[];
}

export interface UnknownBlock extends BlockBase {
  kind: 'unknown';
  resourceType: string;
  tool: string | null;
}

export type Block =
  | TextBlock
  | ContainerBlock
  | MultipleChoiceBlock
  | ShortAnswerBlock
  | AnimationBlock
  | DefinitionMatchBlock
  | ChallengeBlock
  | UnknownBlock;

export interface Section {
  book: string;
  chapter: number;
  section: number;
  title: string;
  /** zyBooks content subject, e.g. "Gerhart_FundamentalsOfFluidMechanics". */
  subject: string | null;
  blocks: Block[];
}

export const sectionLabel = (s: { chapter: number; section: number }) => `${s.chapter}.${s.section}`;
