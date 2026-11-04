import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { balancedEnd, extractJsonObject } from './extract.js';

describe('extractJsonObject', () => {
  it('parses a plain object, with surrounding whitespace', () => {
    expect(extractJsonObject('  {"a":1}\n')).toEqual({ value: { a: 1 } });
  });

  it('takes the first fenced block, with or without a language', () => {
    expect(extractJsonObject('Here you go:\n```json\n{"a":1}\n```\nEnjoy!')).toEqual({ value: { a: 1 } });
    expect(extractJsonObject('```\r\n{"b":2}\r\n```')).toEqual({ value: { b: 2 } });
  });

  it('finds the first balanced object inside prose', () => {
    expect(extractJsonObject('Sure! {"a":{"b":[1,{"c":2}]}} Hope that helps {"z":0}')).toEqual({
      value: { a: { b: [1, { c: 2 }] } },
    });
  });

  it('ignores braces and escaped quotes inside strings', () => {
    const text = 'Stack: {"script":"on mouseUp\\n  put \\"}{\\" into x\\nend mouseUp","n":"{"} trailing }';
    expect(extractJsonObject(text)).toEqual({ value: { script: 'on mouseUp\n  put "}{" into x\nend mouseUp', n: '{' } });
  });

  it('rejects arrays and primitives as not an object', () => {
    expect(extractJsonObject('[{"a":1}]')).toEqual({ error: 'Reply was not a JSON object' });
    expect(extractJsonObject('42')).toEqual({ error: 'Reply was not a JSON object' });
    expect(extractJsonObject('no json here')).toEqual({ error: 'Reply was not a JSON object' });
    expect(extractJsonObject('')).toEqual({ error: 'Reply was not a JSON object' });
  });

  it('reports broken JSON as not valid JSON', () => {
    expect(extractJsonObject('{"a":1,}')).toEqual({ error: 'Reply was not valid JSON' });
    expect(extractJsonObject('{"a":')).toEqual({ error: 'Reply was not valid JSON' });
  });

  it('round-trips any JSON object, wrapped in a fence or prose', () => {
    const wrap = fc.constantFrom(
      (s: string) => s,
      (s: string) => `\`\`\`json\n${s}\n\`\`\``,
      (s: string) => `Here is the stack:\n${s}\nThat is all.`,
    );
    fc.assert(
      fc.property(fc.dictionary(fc.string().filter(k => k !== '__proto__'), fc.jsonValue()), fc.boolean(), wrap, (obj, pretty, w) => {
        const text = w(JSON.stringify(obj, null, pretty ? 2 : undefined));
        expect(extractJsonObject(text)).toEqual({ value: JSON.parse(JSON.stringify(obj)) });
      }),
      { numRuns: 200 },
    );
  });
});

describe('balancedEnd', () => {
  it('returns -1 for an unclosed object', () => {
    expect(balancedEnd('{"a":{}', 0)).toBe(-1);
  });
});
