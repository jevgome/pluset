// Converts the book's HTML (with embedded MathML and LaTeX) into compact plain
// text for AI prompts: structure becomes line breaks and bullets, MathML becomes
// LaTeX, figures become their text descriptions. No DOM needed (runs in tests too).

interface Node {
  tag: string; // '' for text
  attrs: Record<string, string>;
  children: Node[];
  text: string;
}

const VOID = new Set(['br', 'img', 'hr', 'col', 'input', 'meta', 'link', 'source', 'wbr', 'mspace', 'none', 'mprescripts']);
const SKIP = new Set(['script', 'style', 'iframe', 'annotation', 'annotation-xml', 'svg', 'video', 'audio']);
const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'figure', 'figcaption', 'blockquote', 'pre',
  'ul', 'ol', 'table', 'thead', 'tbody', 'tfoot', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'caption',
]);

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', mdash: '—', ndash: '–', minus: '−',
  times: '×', deg: '°', middot: '·', hellip: '…', le: '≤', ge: '≥', ne: '≠', plusmn: '±', rarr: '→',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}

/** Forgiving HTML/MathML parser: unknown or mismatched closing tags are tolerated. */
export function parseHtml(html: string): Node {
  const root: Node = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack: Node[] = [root];
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+|<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1]!;
    if (m[4] !== undefined) {
      top.children.push({ tag: '', attrs: {}, children: [], text: decodeEntities(m[4]) });
      continue;
    }
    if (!m[1]) continue; // comment
    const tag = m[1].toLowerCase();
    if (m[0][1] === '/') {
      const i = stack.map((n) => n.tag).lastIndexOf(tag);
      if (i > 0) stack.length = i;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of (m[2] ?? '').matchAll(/([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs[a[1]!.toLowerCase()] = decodeEntities(a[3] ?? a[4] ?? a[5] ?? '');
    }
    const node: Node = { tag, attrs, children: [], text: '' };
    top.children.push(node);
    if (!VOID.has(tag) && m[3] !== '/') stack.push(node);
  }
  return root;
}

/* ---------- MathML → LaTeX ---------- */

const MO: Record<string, string> = {
  '−': '-', '×': '\\times ', '⋅': '\\cdot ', '·': '\\cdot ', '≤': '\\le ', '≥': '\\ge ', '≈': '\\approx ',
  '∝': '\\propto ', '→': '\\to ', '∞': '\\infty ', '∑': '\\sum ', '∫': '\\int ', '∂': '\\partial ', '±': '\\pm ',
  '⁡': '', '⁢': '', '⁣': '',
};
const MI: Record<string, string> = {
  α: '\\alpha', β: '\\beta', γ: '\\gamma', δ: '\\delta', Δ: '\\Delta', ε: '\\varepsilon', ϵ: '\\epsilon',
  θ: '\\theta', λ: '\\lambda', μ: '\\mu', ν: '\\nu', π: '\\pi', ρ: '\\rho', σ: '\\sigma', τ: '\\tau',
  φ: '\\phi', ϕ: '\\phi', ω: '\\omega', Ω: '\\Omega', ℓ: '\\ell', Σ: '\\Sigma', Π: '\\Pi', Γ: '\\Gamma',
};

const rawText = (n: Node): string => (n.tag === '' ? n.text : n.children.map(rawText).join(''));
const group = (s: string) => (s.length === 1 ? s : `{${s}}`);

function mathChildren(n: Node): string[] {
  return n.children.filter((c) => c.tag !== '' || c.text.trim() !== '').map(mathToLatex);
}

export function mathToLatex(n: Node): string {
  if (n.tag === '') return n.text.trim();
  const kids = () => mathChildren(n);
  const text = () => n.children.map(mathToLatex).join('');
  switch (n.tag) {
    case 'mi': {
      const t = text();
      const mapped = MI[t];
      if (mapped) return `${mapped} `;
      return t.length > 1 ? `\\mathrm{${t}}` : t;
    }
    case 'mn':
      return text();
    case 'mo': {
      const t = text();
      return MO[t] ?? t;
    }
    case 'mtext':
    case 'ms': {
      const t = rawText(n).replace(/ /g, ' ').replace(/\s+/g, ' ');
      return t.trim() ? `\\text{${t}}` : '\\ ';
    }
    case 'mspace':
      return '\\ ';
    case 'msub': {
      const [a = '', b = ''] = kids();
      return `${group(a)}_${group(b)}`;
    }
    case 'msup': {
      const [a = '', b = ''] = kids();
      return `${group(a)}^${group(b)}`;
    }
    case 'msubsup': {
      const [a = '', b = '', c = ''] = kids();
      return `${group(a)}_${group(b)}^${group(c)}`;
    }
    case 'mfrac': {
      const [a = '', b = ''] = kids();
      return `\\frac{${a}}{${b}}`;
    }
    case 'msqrt':
      return `\\sqrt{${kids().join('')}}`;
    case 'mroot': {
      const [a = '', b = ''] = kids();
      return `\\sqrt[${b}]{${a}}`;
    }
    case 'munder': {
      const [a = '', b = ''] = kids();
      return `\\underset{${b}}{${a}}`;
    }
    case 'mover': {
      const [a = '', b = ''] = kids();
      return `\\overset{${b}}{${a}}`;
    }
    case 'munderover': {
      const [a = '', b = '', c = ''] = kids();
      return `${group(a)}_${group(b)}^${group(c)}`;
    }
    case 'mfenced': {
      const open = n.attrs.open ?? '(';
      const close = n.attrs.close ?? ')';
      // Authors use mfenced as a bracketed row; only insert separators when they're explicit.
      const sep = n.attrs.separators?.trim() ?? '';
      return `\\left${open === '{' ? '\\{' : open || '.'}${kids().join(sep ? `${sep[0]} ` : ' ')}\\right${close === '}' ? '\\}' : close || '.'}`;
    }
    case 'mtable':
      return `\\begin{aligned}${n.children.filter((c) => c.tag === 'mtr' || c.tag === 'mlabeledtr').map(mathToLatex).join(' \\\\ ')}\\end{aligned}`;
    case 'mtr':
    case 'mlabeledtr':
      return n.children.filter((c) => c.tag === 'mtd').map(mathToLatex).join(' & ');
    case 'menclose':
      return n.attrs.notation?.includes('box') ? `\\boxed{${kids().join('')}}` : kids().join('');
    case 'semantics':
      return n.children[0] ? mathToLatex(n.children[0]) : '';
    case 'annotation':
    case 'annotation-xml':
      return '';
    default: // math, mrow, mstyle, mpadded, mphantom, mtd, ...
      return kids().join(' ').replace(/\s+/g, ' ').trim();
  }
}

/* ---------- HTML → text ---------- */

interface Ctx {
  out: string[];
  listDepth: number;
}

function emit(ctx: Ctx, s: string) {
  ctx.out.push(s);
}

function walk(n: Node, ctx: Ctx) {
  if (n.tag === '') {
    emit(ctx, n.text.replace(/\s+/g, ' '));
    return;
  }
  if (SKIP.has(n.tag)) return;
  if (n.tag === 'math') {
    const latex = mathToLatex(n);
    emit(ctx, n.attrs.display === 'block' ? `\n\\[${latex}\\]\n` : `\\(${latex}\\)`);
    return;
  }
  const cls = n.attrs.class ?? '';
  if (n.tag === 'img') {
    const alt = (n.attrs.alt ?? '').trim();
    emit(ctx, `\n[Image${n.attrs['data-zy-image'] ? ` ${n.attrs['data-zy-image']}` : ''}${alt ? `: ${alt}` : ''}]\n`);
    return;
  }
  if (n.tag === 'br') return emit(ctx, '\n');
  if (n.tag === 'span' && cls.includes('zy-eq-num')) {
    emit(ctx, ` ${n.children.map((c) => c.text).join('')}`);
    return;
  }
  if (n.tag === 'li') {
    emit(ctx, `\n${'  '.repeat(Math.max(0, ctx.listDepth - 1))}- `);
    // Block children inside an item shouldn't split it across paragraphs.
    emit(ctx, htmlNodeToText(n).replace(/\s*\n\s*/g, ' ').trim());
    return;
  }
  if (n.tag === 'ul' || n.tag === 'ol') {
    ctx.listDepth++;
    emit(ctx, '\n');
    n.children.forEach((c) => walk(c, ctx));
    ctx.listDepth--;
    emit(ctx, '\n');
    return;
  }
  if (n.tag === 'tr') {
    const cells = n.children.filter((c) => c.tag === 'td' || c.tag === 'th').map((c) => htmlNodeToText(c).replace(/\n+/g, ' ').trim());
    emit(ctx, `\n| ${cells.join(' | ')} |`);
    return;
  }
  const block = BLOCK.has(n.tag) || cls.includes('zy-eq');
  if (block) emit(ctx, '\n');
  if (/^h[1-6]$/.test(n.tag) || n.tag === 'b' || n.tag === 'strong') {
    const inner = htmlNodeToText(n).trim();
    if (inner) emit(ctx, /^h/.test(n.tag) ? `\n### ${inner}\n` : `**${inner}**`);
    return;
  }
  n.children.forEach((c) => walk(c, ctx));
  if (block) emit(ctx, '\n');
}

function htmlNodeToText(n: Node): string {
  const ctx: Ctx = { out: [], listDepth: 0 };
  n.children.forEach((c) => walk(c, ctx));
  return ctx.out.join('');
}

export function htmlToText(html: string): string {
  return htmlNodeToText(parseHtml(html))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
