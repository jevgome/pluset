// Allowlist HTML sanitizer for zyBooks content shown in extension pages.
// The extension CSP already blocks inline scripts; this also removes event
// handlers, embeds and non-https resources so captured content stays inert.

const HTML_TAGS = new Set([
  'p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup', 'small', 'mark',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'caption', 'colgroup', 'col', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img', 'figure',
  'figcaption', 'blockquote', 'pre', 'code', 'hr',
]);

const MATHML_TAGS = new Set([
  'math', 'mrow', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mspace', 'msub', 'msup', 'msubsup', 'mfrac',
  'msqrt', 'mroot', 'mtable', 'mtr', 'mtd', 'menclose', 'mfenced', 'munder', 'mover',
  'munderover', 'mstyle', 'mpadded', 'mphantom', 'semantics', 'annotation', 'mmultiscripts',
  'mprescripts', 'none', 'merror', 'mlabeledtr',
]);

/** Removed together with their content. */
const DROP_TAGS = new Set([
  'script', 'style', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button',
  'textarea', 'select', 'option', 'svg', 'canvas', 'audio', 'video', 'source', 'template', 'frame',
  'frameset', 'noscript',
]);

const HTML_ATTRS = new Set([
  'class', 'id', 'href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'align',
  'valign', 'style', 'data-zy-image', 'start', 'type',
]);

const isSafeUrl = (v: string, forSrc: boolean) => {
  const t = v.trim();
  if (!forSrc && t.startsWith('#')) return true;
  return /^https:\/\//i.test(t);
};

function cleanElement(el: Element, doc: Document): Node[] {
  const tag = el.localName.toLowerCase();

  if (tag === 'iframe') {
    const note = doc.createElement('p');
    note.className = 'zy-embed-note';
    note.textContent = 'Embedded media (open this section in zyBooks to view it).';
    return [note];
  }
  if (DROP_TAGS.has(tag)) return [];

  const children = [...el.childNodes].flatMap((c) => cleanNode(c, doc));
  const isMath = MATHML_TAGS.has(tag);
  if (!HTML_TAGS.has(tag) && !isMath) return children; // unwrap unknown tags

  const out = isMath ? doc.createElementNS('http://www.w3.org/1998/Math/MathML', tag) : doc.createElement(tag);
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    const value = attr.value;
    if (name.startsWith('on') || name.includes(':')) continue;
    if (isMath) {
      if (name === 'href' || name === 'src') continue;
      out.setAttribute(name, value);
      continue;
    }
    if (!HTML_ATTRS.has(name)) continue;
    if (name === 'href' && !isSafeUrl(value, false)) continue;
    if (name === 'src' && (tag !== 'img' || !isSafeUrl(value, true))) continue;
    if (name === 'style' && /url\s*\(|expression|@import/i.test(value)) continue;
    out.setAttribute(name, value);
  }
  if (tag === 'a' && out.getAttribute('href')?.startsWith('http')) {
    out.setAttribute('target', '_blank');
    out.setAttribute('rel', 'noopener noreferrer');
  }
  if (tag === 'img') out.setAttribute('loading', 'lazy');
  out.append(...children);
  return [out];
}

function cleanNode(node: Node, doc: Document): Node[] {
  if (node.nodeType === Node.TEXT_NODE) return [doc.createTextNode(node.textContent ?? '')];
  if (node.nodeType === Node.ELEMENT_NODE) return cleanElement(node as Element, doc);
  return []; // comments, processing instructions
}

export function sanitizeHtml(html: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const frag = document.createDocumentFragment();
  for (const child of [...parsed.body.childNodes]) frag.append(...cleanNode(child, document));
  return frag;
}
