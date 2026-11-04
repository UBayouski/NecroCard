import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { highlight, highlightLine, spansToText, type Span } from './highlight.js';
import { KEYWORDS } from '../../interp/tokenizer.js';
import { loadFixture } from '../../model/fixtures.js';

const kinds = (spans: Span[]) => spans.filter(s => s.kind !== 'space').map(s => [s.kind, s.text]);

describe('highlightLine — one example per span kind', () => {
  it('keywords, handler names, identifiers', () => {
    expect(kinds(highlightLine('on mouseUp x'))).toEqual([['keyword', 'on'], ['handler', 'mouseUp'], ['identifier', 'x']]);
    expect(kinds(highlightLine('end mouseUp'))).toEqual([['keyword', 'end'], ['handler', 'mouseUp']]);
    expect(kinds(highlightLine('exit myHandler'))).toEqual([['keyword', 'exit'], ['handler', 'myHandler']]);
    expect(kinds(highlightLine('pass mouseUp'))).toEqual([['keyword', 'pass'], ['handler', 'mouseUp']]);
    expect(kinds(highlightLine('exit repeat'))).toEqual([['keyword', 'exit'], ['keyword', 'repeat']]);
    expect(kinds(highlightLine('put total into it'))).toEqual([['keyword', 'put'], ['identifier', 'total'], ['keyword', 'into'], ['keyword', 'it']]);
  });

  it('keyword case comes from the source, not the lowercased token value', () => {
    expect(kinds(highlightLine('ON MouseUp'))).toEqual([['keyword', 'ON'], ['handler', 'MouseUp']]);
    expect(kinds(highlightLine('Go Next'))).toEqual([['keyword', 'Go'], ['keyword', 'Next']]);
  });

  it('play, tempo and stop highlight as keywords', () => {
    expect(kinds(highlightLine('play tempo 160 "c e g"'))).toEqual([
      ['keyword', 'play'], ['keyword', 'tempo'], ['number', '160'], ['string', '"c e g"'],
    ]);
    expect(kinds(highlightLine('play stop'))).toEqual([['keyword', 'play'], ['keyword', 'stop']]);
  });

  it('strings include both quotes; numbers; operators; punctuation', () => {
    expect(kinds(highlightLine('put "a b" & 3.5 into field ("Q" && n)'))).toEqual([
      ['keyword', 'put'], ['string', '"a b"'], ['operator', '&'], ['number', '3.5'], ['keyword', 'into'],
      ['keyword', 'field'], ['punctuation', '('], ['string', '"Q"'], ['operator', '&&'], ['identifier', 'n'],
      ['punctuation', ')'],
    ]);
    expect(kinds(highlightLine('if a <= 2 then put random(6), 1 into x'))).toContainEqual(['operator', '<=']);
    expect(kinds(highlightLine('put ""'))).toEqual([['keyword', 'put'], ['string', '""']]);
  });

  it('comments after code and on their own line', () => {
    expect(highlightLine('  go next -- onwards!')).toEqual([
      { kind: 'space', text: '  ' }, { kind: 'keyword', text: 'go' }, { kind: 'space', text: ' ' },
      { kind: 'keyword', text: 'next' }, { kind: 'space', text: ' ' }, { kind: 'comment', text: '-- onwards!' },
    ]);
    expect(highlightLine('-- just a comment "with quotes"')).toEqual([{ kind: 'comment', text: '-- just a comment "with quotes"' }]);
    expect(highlightLine('\t-- tabbed')).toEqual([{ kind: 'space', text: '\t' }, { kind: 'comment', text: '-- tabbed' }]);
  });

  it('CR and tabs are whitespace and are kept', () => {
    expect(highlightLine('beep\r')).toEqual([{ kind: 'keyword', text: 'beep' }, { kind: 'space', text: '\r' }]);
    expect(spansToText(highlight('on h\r\n\tbeep\r\nend h\r\n'))).toBe('on h\r\n\tbeep\r\nend h\r\n');
  });

  it('a line the tokenizer rejects is one invalid span; other lines stay highlighted', () => {
    const lines = highlight('on mouseUp\n  put "unterminated into x\n  go next @\nend mouseUp');
    expect(lines[1]).toEqual([{ kind: 'invalid', text: '  put "unterminated into x' }]);
    expect(lines[2]).toEqual([{ kind: 'invalid', text: '  go next @' }]);
    expect(kinds(lines[3])).toEqual([['keyword', 'end'], ['handler', 'mouseUp']]);
    expect(kinds(lines[0])).toEqual([['keyword', 'on'], ['handler', 'mouseUp']]);
  });

  it('empty lines produce no spans; non-ASCII text in strings and comments lines up', () => {
    expect(highlight('a\n\nb').map(l => l.length)).toEqual([1, 0, 1]);
    expect(kinds(highlightLine('put "👻 boo" into x -- ünïcode'))).toEqual([
      ['keyword', 'put'], ['string', '"👻 boo"'], ['keyword', 'into'], ['identifier', 'x'], ['comment', '-- ünïcode'],
    ]);
  });
});

describe('the gap rule matches the tokenizer contract', () => {
  it('every comment span on all fixture scripts and a test corpus starts with "--"', async () => {
    const scripts: string[] = [];
    for (const name of ['quiz', 'adventure', 'flashcards'] as const) {
      const s = await loadFixture(name);
      scripts.push(s.script, ...s.backgrounds.map(b => b.script), ...s.cards.flatMap(c => [c.script, ...c.objects.map(o => o.script)]));
    }
    scripts.push('on h -- a\n  -- b\n  put 1 -- c -- d\nend h --e');
    for (const src of scripts) {
      for (const span of highlight(src).flat()) {
        if (span.kind === 'comment') expect(span.text.startsWith('--')).toBe(true);
      }
      expect(spansToText(highlight(src))).toBe(src);
    }
  });
});

// ---------------------------------------------------------------------------
// Property: concatenated spans reproduce the source exactly
// ---------------------------------------------------------------------------

const keywordArb = fc.constantFrom(...KEYWORDS).chain(k => fc.constantFrom(k, k.toUpperCase(), k[0].toUpperCase() + k.slice(1)));
const identArb = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,8}$/);
const numberArb = fc.oneof(fc.nat({ max: 99999 }).map(String), fc.tuple(fc.nat(999), fc.nat(999)).map(([a, b]) => `${a}.${b}`));
const stringArb = fc.string({ unit: 'grapheme', maxLength: 10 }).filter(s => !/["\r\n]/.test(s)).map(s => `"${s}"`);
const opArb = fc.constantFrom('+', '-', '*', '/', '^', '&', '&&', '=', '<>', '<', '>', '<=', '>=');
const punctArb = fc.constantFrom('(', ')', ',');
const commentArb = fc.string({ unit: 'grapheme', maxLength: 12 }).filter(s => !/[\r\n]/.test(s)).map(s => `--${s}`);
const spaceArb = fc.constantFrom(' ', '  ', '\t', ' \t ');

/** One line: tokens separated by whitespace (so adjacent pieces cannot merge), optional trailing comment. */
const lineArb = fc.tuple(
  fc.array(fc.oneof(keywordArb, identArb, numberArb, stringArb, opArb, punctArb), { maxLength: 8 }),
  fc.array(spaceArb, { minLength: 9, maxLength: 9 }),
  fc.option(commentArb, { nil: undefined }),
  fc.boolean(),
).map(([pieces, spaces, comment, cr]) => {
  let line = spaces[8].length % 2 === 0 ? '' : spaces[8];
  pieces.forEach((p, i) => { line += p + spaces[i]; });
  if (comment) line += comment;
  return cr ? `${line}\r` : line;
});

describe('PBT: highlighting reproduces the source', () => {
  it('any tokenizable script: spans concatenate back to the exact text (200 runs)', () => {
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 1, maxLength: 12 }), lines => {
        const src = lines.join('\n');
        const out = highlight(src);
        expect(spansToText(out)).toBe(src);
        // These lines are tokenizable by construction, so nothing may fall back to `invalid`.
        expect(out.flat().some(s => s.kind === 'invalid')).toBe(false);
        for (const s of out.flat()) if (s.kind === 'comment') expect(s.text.startsWith('--')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('any string at all: spans still concatenate back exactly (200 runs)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 200 }), src => {
        expect(spansToText(highlight(src))).toBe(src);
      }),
      { numRuns: 200 },
    );
  });
});
