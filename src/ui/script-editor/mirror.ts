import { highlight, highlightLineCached, type Span } from './highlight.js';

function spanEl(doc: Document, s: Span): HTMLSpanElement {
  const el = doc.createElement('span');
  el.className = `tok-${s.kind}`;
  el.textContent = s.text;
  return el;
}

/**
 * Fill the mirror `<pre>` with highlighted spans for `source`, laid out exactly like the
 * textarea's text (one `\n` text node between lines). The error line's spans are wrapped in a
 * `.script-line--error` span. Text is set with textContent only.
 */
export function renderMirror(pre: HTMLElement, source: string, errorLine: number | null): void {
  const doc = pre.ownerDocument;
  const nodes: Node[] = [];
  highlight(source).forEach((spans, i) => {
    if (i > 0) nodes.push(doc.createTextNode('\n'));
    const line = doc.createElement('span');
    line.className = errorLine === i + 1 ? 'code-line script-line--error' : 'code-line';
    line.dataset.line = String(i + 1);
    line.append(...spans.map(s => spanEl(doc, s)));
    nodes.push(line);
  });
  // A textarea shows an empty last line after a trailing newline; a <pre> does not. Pad it.
  if (source.endsWith('\n')) nodes.push(doc.createTextNode(' '));
  pre.replaceChildren(...nodes);
}

/** One-line mirror for the message box. */
export function renderLineMirror(el: HTMLElement, line: string): void {
  el.replaceChildren(...highlightLineCached(line).map(s => spanEl(el.ownerDocument, s)));
}

/** Gutter: one number per line, `!` marker on the error line (not colour alone). */
export function renderGutter(gutter: HTMLElement, lineCount: number, errorLine: number | null): void {
  const doc = gutter.ownerDocument;
  const rows: HTMLElement[] = [];
  for (let n = 1; n <= lineCount; n++) {
    const row = doc.createElement('div');
    row.className = n === errorLine ? 'code-gutter-line code-gutter-line--error' : 'code-gutter-line';
    if (n === errorLine) {
      const mark = doc.createElement('span');
      mark.className = 'code-gutter-mark';
      mark.textContent = '!';
      row.append(mark);
    }
    row.append(String(n));
    rows.push(row);
  }
  gutter.replaceChildren(...rows);
  gutter.dataset.digits = String(String(lineCount).length);
}
