import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToText } from '../src/ai/text';

describe('htmlToText', () => {
  it('keeps paragraphs, lists and emphasis', () => {
    expect(htmlToText('<p>First &amp; <b>bold</b>.</p><ul><li>one</li><li>two</li></ul><p>Last</p>')).toBe(
      'First & **bold**.\n\n- one\n- two\n\nLast',
    );
  });

  it('converts MathML to LaTeX', () => {
    const frac =
      '<math display="block"><mrow><msub><mi>K</mi><mi>L</mi></msub><mo>=</mo><mfrac><msub><mi>h</mi><mi>L</mi></msub><mrow><msup><mi>V</mi><mn>2</mn></msup><mo>/</mo><mn>2</mn><mi>g</mi></mrow></mfrac></mrow></math>';
    expect(htmlToText(frac)).toBe('\\[K_L = \\frac{h_L}{V^2 / 2 g}\\]');
    expect(htmlToText('<p>Flow <math><mi>ρ</mi><mi>V</mi></math> here</p>')).toBe('Flow \\(\\rho V\\) here');
  });

  it('handles fences, text and operators', () => {
    const m = '<math><mfenced open="(" close=")"><mn>1</mn><mo>−</mo><mi>x</mi></mfenced><mtext>&#xa0;ft</mtext></math>';
    expect(htmlToText(m)).toBe('\\(\\left(1 - x\\right) \\text{ ft}\\)');
  });

  it('keeps LaTeX delimiters already in the text', () => {
    expect(htmlToText('<p>where \\(a\\) is in feet</p>')).toBe('where \\(a\\) is in feet');
  });

  it('turns tables into pipe rows and images into descriptions', () => {
    const html = '<table><tr><th>Part</th><th>K</th></tr><tr><td>Elbow</td><td>1.5</td></tr></table><img data-zy-image="abc" alt="A valve">';
    expect(htmlToText(html)).toBe('| Part | K |\n| Elbow | 1.5 |\n\n[Image abc: A valve]');
  });

  it('drops scripts and annotations, tolerates broken markup', () => {
    expect(htmlToText('<p>a<script>evil()</script> b</p><div>c</span></div>')).toBe('a b\n\nc');
  });
});

describe('decodeEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('&lt;&#x3b3;&#957;&nbsp;&unknown;')).toBe('<γν &unknown;');
  });
});
