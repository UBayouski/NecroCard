/** One indentation step. */
export const INDENT = '  ';

/** The result of indenting or outdenting: one replacement plus the shifted selection. */
export interface Shift {
  /** Full text after the change (tests and the fallback path). */
  text: string;
  /**
   * The minimal replacement for the native-undo path: replace text[from, to) with `insert`.
   * Single line: indent inserts two spaces at the line start (from === to), outdent deletes the
   * leading spaces (insert === ''), so native undo restores a caret, not a selection.
   * Multi-line: the whole line range is replaced.
   */
  from: number;
  to: number;
  insert: string;
  selStart: number;
  selEnd: number;
}

/**
 * Indent (`in`) or outdent (`out`) every line touched by the selection, or the caret's line.
 * A selection ending exactly at the start of a line does not touch that line. Outdent removes
 * up to two leading spaces, or one leading tab. Returns null when nothing would change.
 */
export function shiftLines(text: string, selStart: number, selEnd: number, dir: 'in' | 'out'): Shift | null {
  const a = Math.max(0, Math.min(selStart, selEnd, text.length));
  let b = Math.max(0, Math.min(Math.max(selStart, selEnd), text.length));
  // A selection that ends at column 1 of a later line leaves that line alone.
  if (b > a && text[b - 1] === '\n') b -= 1;
  const from = text.lastIndexOf('\n', a - 1) + 1;
  const nl = text.indexOf('\n', b);
  const to = nl === -1 ? text.length : nl;

  const lines = text.slice(from, to).split('\n');
  const deltas: number[] = [];
  const shifted = lines.map(line => {
    if (dir === 'in') { deltas.push(INDENT.length); return INDENT + line; }
    let n = 0;
    if (line.startsWith('\t')) n = 1;
    else while (n < INDENT.length && line[n] === ' ') n++;
    deltas.push(-n);
    return line.slice(n);
  });
  if (deltas.every(d => d === 0)) return null;
  const insert = shifted.join('\n');

  // Shift a selection offset: by the first line's delta if it is on the first line, plus every
  // full line before its line. Never move it before the start of its own line.
  const move = (offset: number): number => {
    if (offset < from) return offset;
    let lineStart = from;
    let acc = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineEnd = lineStart + lines[i].length;
      if (offset <= lineEnd || i === lines.length - 1) {
        const col = offset - lineStart;
        const newCol = Math.max(0, col + deltas[i]);
        // A caret inside removed indentation lands at the new line start.
        return lineStart + acc + (dir === 'out' && col < -deltas[i] ? 0 : newCol);
      }
      acc += deltas[i];
      lineStart = lineEnd + 1;
    }
    return offset + acc;
  };

  const newSelStart = move(Math.min(selStart, selEnd));
  const newSelEnd = Math.max(selStart, selEnd) > to
    ? Math.max(selStart, selEnd) + (insert.length - (to - from))
    : move(Math.max(selStart, selEnd));
  const result = text.slice(0, from) + insert + text.slice(to);
  if (lines.length === 1) {
    // Touch only the indentation, so the browser's undo of this edit leaves a caret.
    const removed = -deltas[0];
    return dir === 'in'
      ? { text: result, from, to: from, insert: INDENT, selStart: newSelStart, selEnd: newSelEnd }
      : { text: result, from, to: from + removed, insert: '', selStart: newSelStart, selEnd: newSelEnd };
  }
  return { text: result, from, to, insert, selStart: newSelStart, selEnd: newSelEnd };
}
