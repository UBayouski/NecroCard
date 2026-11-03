import { tokenize, type Token, type TokenType } from '../../interp/tokenizer.js';

export type SpanKind =
  | 'keyword' | 'handler' | 'identifier' | 'string' | 'number' | 'operator' | 'punctuation'
  | 'comment' | 'space' | 'invalid';

export interface Span {
  kind: SpanKind;
  text: string;
}

const KIND: Partial<Record<TokenType, SpanKind>> = {
  keyword: 'keyword',
  identifier: 'identifier',
  string: 'string',
  number: 'number',
  operator: 'operator',
  punctuation: 'punctuation',
};

/** Keywords whose next identifier names a handler (`on mouseUp`, `end mouseUp`, `exit h`, `pass h`). */
const HANDLER_INTRO = new Set(['on', 'end', 'exit', 'pass']);

/** Whitespace the tokenizer skips (it skips nothing else except `--` comments). */
const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\r';

/**
 * Text between tokens. The tokenizer skips only whitespace and `--` comments, so from the first
 * non-whitespace character to the end of the gap is a comment. This is the tokenizer's contract,
 * not a second lexer (open question 1); highlight.test.ts checks every comment starts with `--`.
 */
function gap(text: string, out: Span[]): void {
  let i = 0;
  while (i < text.length && isSpace(text[i])) i++;
  if (i > 0) out.push({ kind: 'space', text: text.slice(0, i) });
  if (i < text.length) out.push({ kind: 'comment', text: text.slice(i) });
}

/** Source length of a token: string tokens lose their quotes in `value`. */
function sourceLength(t: Token): number {
  return t.type === 'string' ? t.value.length + 2 : t.value.length;
}

/**
 * Highlight one line (no newline) using the interpreter's tokenizer. A line the tokenizer rejects
 * becomes one `invalid` span. Concatenating the span texts always gives back `line` exactly.
 */
export function highlightLine(line: string): Span[] {
  if (line === '') return [];
  let tokens: Token[];
  try {
    tokens = tokenize(line);
  } catch {
    return [{ kind: 'invalid', text: line }];
  }
  const out: Span[] = [];
  let pos = 0;
  let prev: Token | null = null;
  for (const t of tokens) {
    if (t.type === 'eof') break;
    if (t.type === 'newline') continue; // cannot occur within one line; kept for safety
    const start = t.column - 1;
    if (start > pos) gap(line.slice(pos, start), out);
    const end = start + sourceLength(t);
    const kind: SpanKind = t.type === 'identifier' && prev?.type === 'keyword' && HANDLER_INTRO.has(prev.value)
      ? 'handler'
      : KIND[t.type] ?? 'identifier';
    out.push({ kind, text: line.slice(start, end) });
    pos = end;
    prev = t;
  }
  if (pos < line.length) gap(line.slice(pos), out);
  return out;
}

const CACHE_LIMIT = 500;
const cache = new Map<string, Span[]>();

/** highlightLine with a small bounded cache, so unchanged lines are not re-tokenized per keystroke. */
export function highlightLineCached(line: string): Span[] {
  const hit = cache.get(line);
  if (hit) return hit;
  const spans = highlightLine(line);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(line, spans);
  return spans;
}

/** Highlight a whole script: one span list per line (split on `\n`; CR stays in the line). */
export function highlight(source: string): Span[][] {
  return source.split('\n').map(highlightLineCached);
}

/** Reassemble the source from spans (the round-trip the property test checks). */
export function spansToText(lines: Span[][]): string {
  return lines.map(spans => spans.map(s => s.text).join('')).join('\n');
}
