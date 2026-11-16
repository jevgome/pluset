import { describe, expect, it } from 'vitest';
import { expandZyMarkup, normalizeLatex } from '../src/core/zymarkup';

describe('expandZyMarkup', () => {
  it('converts [table] markup, keeping & inside math intact', () => {
    const src = 'See: [table][\\(\\text{Pipe}\\)&\\(\\varepsilon\\)\n\\(\\text{Steel}\\)&\\(a & b\\)\n] done';
    expect(expandZyMarkup(src)).toBe(
      'See: <div class="table"><table><thead><tr><th>\\(\\text{Pipe}\\)</th><th>\\(\\varepsilon\\)</th></tr></thead>' +
        '<tbody><tr><td>\\(\\text{Steel}\\)</td><td>\\(a & b\\)</td></tr></tbody></table></div> done',
    );
  });

  it('handles brackets inside math in a table', () => {
    const out = expandZyMarkup('[table][\\(x_{[1]}\\)&b\n1&2] after');
    expect(out).toContain('<th>\\(x_{[1]}\\)</th>');
    expect(out.endsWith(' after')).toBe(true);
  });

  it('converts [image](id)(alt) with parentheses in the description', () => {
    expect(expandZyMarkup('x [image](abc_1-Z)(Two plates (top and bottom) <moving>) y')).toBe(
      'x <figure class="zy-ch-figure" data-zy-image="abc_1-Z"><div class="zy-img-missing">Figure</div>' +
        '<figcaption>Two plates (top and bottom) &lt;moving&gt;</figcaption></figure> y',
    );
  });

  it('accepts image markup with dimensions', () => {
    expect(expandZyMarkup('[image 175 93](id9)(A contraction)')).toContain('data-zy-image="id9"');
    expect(expandZyMarkup('[image 175 93](id9)(A contraction)')).toContain('<figcaption>A contraction</figcaption>');
  });

  it('leaves ordinary text and unterminated markup alone', () => {
    expect(expandZyMarkup('a [b] \\(c[d]\\) [table][oops')).toBe('a [b] \\(c[d]\\) [table][oops');
  });
});

describe('normalizeLatex', () => {
  it('renders align environments unnumbered', () => {
    expect(normalizeLatex('\\[\\begin{align} a &= b \\end{align}\\] \\begin{align*}x\\end{align*}')).toBe(
      '\\[\\begin{aligned} a &= b \\end{aligned}\\] \\begin{aligned}x\\end{aligned}',
    );
  });
});
