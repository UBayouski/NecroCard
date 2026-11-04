import { describe, it, expect } from 'vitest';
import { tokenize } from './tokenizer.js';
import { NecroTalkError } from './errors.js';
import type { Token } from './tokenizer.js';

function types(tokens: Token[]): string[] {
  return tokens.map(t => t.type);
}
function values(tokens: Token[]): string[] {
  return tokens.map(t => t.value);
}

describe('tokenize — basic handler', () => {
  it('play, tempo and stop are keywords; a notes string is a string token', () => {
    const toks = tokenize('on h\n  play tempo 160 "c e g"\n  play stop\nend h');
    const kw = toks.filter(t => t.type === 'keyword').map(t => t.value);
    expect(kw).toEqual(expect.arrayContaining(['play', 'tempo', 'stop']));
    expect(toks.some(t => t.type === 'string' && t.value === 'c e g')).toBe(true);
  });

  it('tokenizes a minimal handler correctly', () => {
    const src = 'on mouseUp\n  beep\nend mouseUp';
    const toks = tokenize(src);
    // on(kw), mouseUp(ident — handler names are not reserved words), newline,
    // beep(kw), newline, end(kw), mouseUp(ident), eof
    expect(toks[0]).toMatchObject({ type: 'keyword', value: 'on' });
    expect(toks[1]).toMatchObject({ type: 'identifier', value: 'mouseUp' });
    expect(toks[2]).toMatchObject({ type: 'newline' });
    expect(toks[3]).toMatchObject({ type: 'keyword', value: 'beep' });
    expect(toks[4]).toMatchObject({ type: 'newline' });
    expect(toks[5]).toMatchObject({ type: 'keyword', value: 'end' });
    expect(toks[6]).toMatchObject({ type: 'identifier', value: 'mouseUp' });
    expect(toks[7]).toMatchObject({ type: 'eof' });
  });
});

describe('tokenize — keywords', () => {
  it('normalizes keywords to lowercase', () => {
    const toks = tokenize('ON END IF THEN ELSE');
    expect(values(toks).slice(0, 5)).toEqual(['on', 'end', 'if', 'then', 'else']);
    expect(types(toks).slice(0, 5)).toEqual(['keyword', 'keyword', 'keyword', 'keyword', 'keyword']);
  });

  it('handles mixed-case keywords', () => {
    const toks = tokenize('On mouseUp');
    expect(toks[0]).toMatchObject({ type: 'keyword', value: 'on' });
    // mouseUp is a handler name (identifier), not a reserved keyword
    expect(toks[1]).toMatchObject({ type: 'identifier', value: 'mouseUp' });
  });
});

describe('tokenize — identifiers', () => {
  it('emits identifier for non-keyword names', () => {
    const toks = tokenize('myVar score_1');
    expect(toks[0]).toMatchObject({ type: 'identifier', value: 'myVar' });
    expect(toks[1]).toMatchObject({ type: 'identifier', value: 'score_1' });
  });
});

describe('tokenize — string literals', () => {
  it('strips quotes from string literals', () => {
    const toks = tokenize('"hello world"');
    expect(toks[0]).toMatchObject({ type: 'string', value: 'hello world' });
  });

  it('handles empty string', () => {
    const toks = tokenize('""');
    expect(toks[0]).toMatchObject({ type: 'string', value: '' });
  });

  it('handles string with special chars (no escape needed)', () => {
    const toks = tokenize('"hello, world!"');
    expect(toks[0]).toMatchObject({ type: 'string', value: 'hello, world!' });
  });
});

describe('tokenize — numbers', () => {
  it('tokenizes integer', () => {
    const toks = tokenize('42');
    expect(toks[0]).toMatchObject({ type: 'number', value: '42' });
  });

  it('tokenizes decimal', () => {
    const toks = tokenize('3.14');
    expect(toks[0]).toMatchObject({ type: 'number', value: '3.14' });
  });

  it('handles number followed by operator without space', () => {
    const toks = tokenize('2+3');
    expect(toks[0]).toMatchObject({ type: 'number', value: '2' });
    expect(toks[1]).toMatchObject({ type: 'operator', value: '+' });
    expect(toks[2]).toMatchObject({ type: 'number', value: '3' });
  });
});

describe('tokenize — operators', () => {
  it('tokenizes all single-char operators', () => {
    const toks = tokenize('+ - * / ^ = < > &');
    const vals = values(toks).slice(0, 9);
    expect(vals).toEqual(['+', '-', '*', '/', '^', '=', '<', '>', '&']);
  });

  it('tokenizes two-char operators', () => {
    const toks = tokenize('<= >= <> &&');
    expect(toks[0]).toMatchObject({ type: 'operator', value: '<=' });
    expect(toks[1]).toMatchObject({ type: 'operator', value: '>=' });
    expect(toks[2]).toMatchObject({ type: 'operator', value: '<>' });
    expect(toks[3]).toMatchObject({ type: 'operator', value: '&&' });
  });

  it('tokenizes mod as keyword', () => {
    const toks = tokenize('mod');
    expect(toks[0]).toMatchObject({ type: 'keyword', value: 'mod' });
  });
});

describe('tokenize — punctuation', () => {
  it('tokenizes parentheses and comma', () => {
    const toks = tokenize('( ) ,');
    expect(toks[0]).toMatchObject({ type: 'punctuation', value: '(' });
    expect(toks[1]).toMatchObject({ type: 'punctuation', value: ')' });
    expect(toks[2]).toMatchObject({ type: 'punctuation', value: ',' });
  });
});

describe('tokenize — comments', () => {
  it('strips comment lines entirely', () => {
    const src = 'on mouseUp\n-- this is a comment\n  beep\nend mouseUp';
    const toks = tokenize(src);
    // handler name 'mouseUp' is an identifier, not a keyword
    const keywordValues = toks.filter(t => t.type === 'keyword').map(t => t.value);
    expect(keywordValues).toEqual(['on', 'beep', 'end']);
  });

  it('strips inline comment', () => {
    const src = 'beep -- a beep';
    const toks = tokenize(src);
    expect(toks[0]).toMatchObject({ type: 'keyword', value: 'beep' });
    expect(toks[1]).toMatchObject({ type: 'eof' });
  });
});

describe('tokenize — newlines', () => {
  it('emits newline tokens', () => {
    const toks = tokenize('beep\nbeep');
    expect(toks[1]).toMatchObject({ type: 'newline' });
  });

  it('tracks line numbers correctly', () => {
    const src = 'on mouseUp\n  beep\nend mouseUp';
    const toks = tokenize(src);
    expect(toks[0].line).toBe(1); // on
    expect(toks[3].line).toBe(2); // beep
    expect(toks[5].line).toBe(3); // end
  });
});

describe('tokenize — errors', () => {
  it('throws NecroTalkError for unterminated string (EOF)', () => {
    expect(() => tokenize('"unterminated')).toThrow(NecroTalkError);
  });

  it('throws NecroTalkError for string containing raw newline', () => {
    expect(() => tokenize('"line1\nline2"')).toThrow(NecroTalkError);
  });

  it('throws NecroTalkError for invalid character @', () => {
    expect(() => tokenize('beep @ beep')).toThrow(NecroTalkError);
  });

  it('error carries correct line number', () => {
    try {
      tokenize('beep\n@');
    } catch (e) {
      expect(e).toBeInstanceOf(NecroTalkError);
      expect((e as NecroTalkError).line).toBe(2);
    }
  });

  it('unterminated string error carries start line', () => {
    try {
      tokenize('put "oops into x');
    } catch (e) {
      expect(e).toBeInstanceOf(NecroTalkError);
      expect((e as NecroTalkError).line).toBe(1);
    }
  });
});

describe('tokenize — eof', () => {
  it('always ends with eof token', () => {
    const toks = tokenize('beep');
    expect(toks[toks.length - 1].type).toBe('eof');
  });

  it('empty string produces just eof', () => {
    const toks = tokenize('');
    expect(toks).toHaveLength(1);
    expect(toks[0].type).toBe('eof');
  });
});

describe('tokenize — regression: lone trailing quote', () => {
  it('a lone " at the very end of the source is an unterminated string', () => {
    expect(() => tokenize('beep "')).toThrow('Line 1: Unterminated string literal.');
  });

  it('an empty string literal at the end is still valid', () => {
    expect(tokenize('""')[0]).toMatchObject({ type: 'string', value: '' });
  });
});
