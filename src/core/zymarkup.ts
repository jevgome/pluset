// Converts zyBooks' lightweight markup in challenge text and solutions to HTML:
//   [table][cell & cell & cell \n cell & cell & cell ...]   (first row is the header)
//   [image](imageId)(description)
// and normalizes LaTeX that renders differently in KaTeX than in zyBooks' MathJax setup.

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Index just past the end of a math region starting at `i` (\( … \) or \[ … \]), or -1. */
function skipMath(s: string, i: number): number {
  if (s[i] !== '\\') return -1;
  const close = s[i + 1] === '(' ? '\\)' : s[i + 1] === '[' ? '\\]' : null;
  if (!close) return -1;
  const end = s.indexOf(close, i + 2);
  return end === -1 ? s.length : end + 2;
}

/** Finds the bracket matching the opener at `open`, ignoring brackets inside math. */
function matchBracket(s: string, open: number, opener: string, closer: string): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const after = skipMath(s, i);
    if (after !== -1) {
      i = after - 1;
      continue;
    }
    if (s[i] === '\\') {
      i++; // escaped character
      continue;
    }
    if (s[i] === opener) depth++;
    else if (s[i] === closer && --depth === 0) return i;
  }
  return -1;
}

/** Splits on `&` that are outside math regions. */
function splitCells(row: string): string[] {
  const cells: string[] = [];
  let start = 0;
  for (let i = 0; i < row.length; i++) {
    const after = skipMath(row, i);
    if (after !== -1) {
      i = after - 1;
      continue;
    }
    if (row[i] === '&') {
      cells.push(row.slice(start, i));
      start = i + 1;
    }
  }
  cells.push(row.slice(start));
  return cells.map((c) => c.trim());
}

function tableHtml(body: string): string {
  const rows = body.split('\n').map((r) => r.trim()).filter(Boolean).map(splitCells);
  if (rows.length === 0) return '';
  const [head, ...rest] = rows;
  const tr = (cells: string[], tag: 'th' | 'td') => `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
  return `<div class="table"><table><thead>${tr(head!, 'th')}</thead><tbody>${rest.map((r) => tr(r, 'td')).join('')}</tbody></table></div>`;
}

function imageHtml(id: string, alt: string): string {
  // Challenge/solution images use IDs we can't download yet; show the book's description instead.
  return `<figure class="zy-ch-figure" data-zy-image="${escapeHtml(id)}"><div class="zy-img-missing">Figure</div><figcaption>${escapeHtml(alt)}</figcaption></figure>`;
}

export function expandZyMarkup(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('[table][', i)) {
      const close = matchBracket(text, i + 7, '[', ']');
      if (close !== -1) {
        out += tableHtml(text.slice(i + 8, close));
        i = close + 1;
        continue;
      }
    }
    // [image](id)(alt) or [image W H](id)(alt)
    const imageHead = text.startsWith('[image', i) ? /^\[image(?: \d+ \d+)?\]\(/.exec(text.slice(i, i + 24)) : null;
    if (imageHead) {
      const open = i + imageHead[0].length - 1;
      const idEnd = matchBracket(text, open, '(', ')');
      if (idEnd !== -1 && text[idEnd + 1] === '(') {
        const altEnd = matchBracket(text, idEnd + 1, '(', ')');
        if (altEnd !== -1) {
          out += imageHtml(text.slice(open + 1, idEnd).trim(), text.slice(idEnd + 2, altEnd).trim());
          i = altEnd + 1;
          continue;
        }
      }
    }
    out += text[i];
    i++;
  }
  return out;
}

/**
 * zyBooks' MathJax doesn't number `align` environments; KaTeX does.
 * Inside \[ … \] the unnumbered equivalent is `aligned`.
 */
export const normalizeLatex = (s: string) => s.replace(/\\(begin|end)\{align\*?\}/g, '\\$1{aligned}');
