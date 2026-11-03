import { describe, expect, it } from 'vitest';
import { findError } from './errors.js';
import { INDENT, shiftLines } from './indent.js';
import { diffLines, MAX_CELLS } from './diff.js';
import { HISTORY_SIZE, LineHistory } from './lineHistory.js';

describe('findError', () => {
  it('maps parser errors to their line', () => {
    expect(findError('on mouseUp\n  go next\nend mouseDown')).toEqual({
      line: 3, message: expect.stringMatching(/^Line 3: Expected "end mouseUp"/),
    });
  });

  it('maps tokenizer errors to their line', () => {
    const e = findError('on h\n  put "oops into x\nend h');
    expect(e?.line).toBe(2);
    expect(e?.message).toMatch(/^Line 2: Unterminated string/);
  });

  it('clamps a line past the end of the script', () => {
    const e = findError('on h\n  beep');
    expect(e).not.toBeNull();
    expect(e!.line).toBeGreaterThanOrEqual(1);
    expect(e!.line).toBeLessThanOrEqual(2);
  });

  it('empty or blank scripts and valid scripts have no error', () => {
    expect(findError('')).toBeNull();
    expect(findError('  \n\t\n')).toBeNull();
    expect(findError('on h\n  beep\nend h')).toBeNull();
  });
});

describe('shiftLines', () => {
  const text = 'on h\n  beep\nend h';
  /** Applying the minimal replacement must give the same text as the full result. */
  const applied = (src: string, r: NonNullable<ReturnType<typeof shiftLines>>) =>
    src.slice(0, r.from) + r.insert + src.slice(r.to);

  it('single line, caret: indent inserts two spaces at the line start and moves the caret by two', () => {
    const r = shiftLines(text, 6, 6, 'in')!; // caret inside "  beep" after the first space
    expect(r.text).toBe('on h\n    beep\nend h');
    expect([r.from, r.to, r.insert]).toEqual([5, 5, '  ']);
    expect([r.selStart, r.selEnd]).toEqual([8, 8]);
    expect(applied(text, r)).toBe(r.text);
  });

  it('single line, selection inside the line: still only two spaces inserted; selection shifts by two', () => {
    const src = 'on h\nbeep\nend h';
    const r = shiftLines(src, 5, 9, 'in')!; // "beep" selected
    expect([r.from, r.to, r.insert]).toEqual([5, 5, '  ']);
    expect([r.selStart, r.selEnd]).toEqual([7, 11]);
    expect(applied(src, r)).toBe('on h\n  beep\nend h');
  });

  it('single line, outdent: deletes only the leading spaces (or one tab); caret moves back', () => {
    const r = shiftLines('  beep', 4, 4, 'out')!;
    expect([r.from, r.to, r.insert]).toEqual([0, 2, '']);
    expect([r.selStart, r.selEnd]).toEqual([2, 2]);
    expect(applied('  beep', r)).toBe('beep');
    const t = shiftLines('x\n\tbeep', 4, 4, 'out')!;
    expect([t.from, t.to, t.insert]).toEqual([2, 3, '']);
    expect([t.selStart, t.selEnd]).toEqual([3, 3]);
    expect(t.text).toBe('x\nbeep');
    const one = shiftLines(' beep', 3, 3, 'out')!; // fewer than two spaces
    expect([one.from, one.to, one.insert, one.selStart]).toEqual([0, 1, '', 2]);
  });

  it('single line, caret inside the removed indentation lands at the line start', () => {
    const r = shiftLines('  beep', 1, 1, 'out')!;
    expect(r.text).toBe('beep');
    expect([r.from, r.to, r.insert]).toEqual([0, 2, '']);
    expect([r.selStart, r.selEnd]).toEqual([0, 0]);
  });

  it('a selection ending at column 1 of the next line is single-line (only that first line changes)', () => {
    const r = shiftLines(text, 0, 5, 'in')!; // "on h\n" selected
    expect(r.text).toBe('  on h\n  beep\nend h');
    expect([r.from, r.to, r.insert]).toEqual([0, 0, '  ']);
    expect([r.selStart, r.selEnd]).toEqual([2, 7]);
    expect(applied(text, r)).toBe(r.text);
  });

  it('multi-line: the whole line range is replaced and both selection ends shift', () => {
    const r = shiftLines(text, 1, 14, 'in')!;
    expect(r.text).toBe('  on h\n    beep\n  end h');
    expect([r.from, r.to, r.insert]).toEqual([0, 17, '  on h\n    beep\n  end h']);
    expect([r.selStart, r.selEnd]).toEqual([3, 20]);
    const o = shiftLines(r.text, r.selStart, r.selEnd, 'out')!;
    expect([o.from, o.to]).toEqual([0, r.text.length]);
    expect(o.text).toBe(text);
    expect([o.selStart, o.selEnd]).toEqual([1, 14]);
  });

  it('outdent with no indentation returns null; multi-line outdent removes up to two spaces per line', () => {
    expect(shiftLines('   x\n y\n\tz', 0, 10, 'out')!.text).toBe(' x\ny\nz');
    expect(shiftLines('on h', 0, 0, 'out')).toBeNull();
  });

  it('indent then outdent restores the text', () => {
    const src = 'on h\n  if x then\n    beep\n  end if\nend h';
    const a = shiftLines(src, 0, src.length, 'in')!;
    const b = shiftLines(a.text, a.selStart, a.selEnd, 'out')!;
    expect(b.text).toBe(src);
    expect(INDENT).toBe('  ');
  });
});

describe('diffLines', () => {
  it('equal scripts are all "same" with matching line numbers', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual([
      { kind: 'same', text: 'a', oldLine: 1, newLine: 1 },
      { kind: 'same', text: 'b', oldLine: 2, newLine: 2 },
    ]);
  });

  it('a changed line in the middle: removal before addition', () => {
    expect(diffLines('on h\n  go nxt\nend h', 'on h\n  go next\nend h')).toEqual([
      { kind: 'same', text: 'on h', oldLine: 1, newLine: 1 },
      { kind: 'del', text: '  go nxt', oldLine: 2, newLine: null },
      { kind: 'add', text: '  go next', oldLine: null, newLine: 2 },
      { kind: 'same', text: 'end h', oldLine: 3, newLine: 3 },
    ]);
  });

  it('pure additions and pure removals', () => {
    expect(diffLines('a', 'a\nb\nc').map(r => [r.kind, r.newLine])).toEqual([['same', 1], ['add', 2], ['add', 3]]);
    expect(diffLines('a\nb\nc', 'c').map(r => [r.kind, r.oldLine])).toEqual([['del', 1], ['del', 2], ['same', 3]]);
  });

  it('falls back to remove-all/add-all above the cell limit', () => {
    const big = Array.from({ length: Math.ceil(Math.sqrt(MAX_CELLS)) + 1 }, (_, i) => `l${i}`).join('\n');
    const rows = diffLines(big, big + '\nextra');
    expect(rows.every(r => r.kind !== 'same')).toBe(true);
    expect(rows.filter(r => r.kind === 'add').at(-1)!.text).toBe('extra');
  });
});

describe('LineHistory', () => {
  it('stores submitted lines, skipping empty lines and repeats of the newest', () => {
    const h = new LineHistory();
    for (const l of ['go next', '', '  ', 'go next', 'beep', 'go next']) h.push(l);
    expect(h.entries).toEqual(['go next', 'beep', 'go next']);
  });

  it('keeps at most 50 entries', () => {
    const h = new LineHistory();
    for (let i = 0; i < 60; i++) h.push(`line ${i}`);
    expect(h.entries.length).toBe(HISTORY_SIZE);
    expect(h.entries[0]).toBe('line 10');
  });

  it('Up walks back, Down walks forward and restores the draft', () => {
    const h = new LineHistory();
    h.push('one');
    h.push('two');
    expect(h.up('typing…')).toBe('two');
    expect(h.up('two')).toBe('one');
    expect(h.up('one')).toBeNull();
    expect(h.down()).toBe('two');
    expect(h.down()).toBe('typing…');
    expect(h.down()).toBeNull();
    h.reset();
    expect(h.up('')).toBe('two');
  });

  it('empty history: Up and Down do nothing', () => {
    const h = new LineHistory();
    expect(h.up('x')).toBeNull();
    expect(h.down()).toBeNull();
  });
});
