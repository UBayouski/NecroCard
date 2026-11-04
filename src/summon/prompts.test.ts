import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parse } from '../interp/parser.js';
import { KEYWORDS } from '../interp/tokenizer.js';
import { validateStack } from '../model/validate.js';
import schema from '../model/stack.schema.json' with { type: 'json' };
import type { ScriptContext } from './agentClient.js';
import type { SummonRequest } from './contract.js';
import { GRAMMAR_EXAMPLES, GRAMMAR_SUMMARY, RESERVED_WORDS } from './grammar.js';
import {
  buildPrompt, delimit, EXAMPLE_STACK, EXPLAIN_INSTRUCTION, explainMessage, FIX_INSTRUCTION, fixMessage,
  retryMessage, SCHEMA_TEXT, summonMessage, SYSTEM_INSTRUCTION,
} from './prompts.js';

async function ownSource(relative: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync(p: URL, e: 'utf8'): string };
  return fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
}

const context: ScriptContext = {
  owner: { type: 'button', name: 'Next' },
  stackName: 'Quiz',
  cardName: 'Q1',
  backgroundName: 'Main',
  objectNames: [{ type: 'field', name: 'Score' }, { type: 'button', name: 'Next' }],
};

const requests: SummonRequest[] = [
  { kind: 'summon', payload: { prompt: 'a two-card quiz' } },
  { kind: 'retry', payload: { prompt: 'a quiz', previous: '{"id":1}', errors: ['Schema: (root) bad', 'Line 2: x.'] } },
  { kind: 'explain', payload: { script: 'on mouseUp\n  beep\nend mouseUp', context } },
  { kind: 'fix', payload: { script: 'on mouseUp\nend click', error: 'Line 2: Expected "end mouseUp".', context } },
];

describe('grammar summary', () => {
  it.each(GRAMMAR_EXAMPLES.map(e => [e.title, e.script]))('example parses: %s', (_title, script) => {
    expect(() => parse(script)).not.toThrow();
  });

  it('has at least six examples and includes every one', () => {
    expect(GRAMMAR_EXAMPLES.length).toBeGreaterThanOrEqual(6);
    for (const e of GRAMMAR_EXAMPLES) expect(GRAMMAR_SUMMARY).toContain(e.script);
  });

  it('covers the required constructs (REQ-1.1 item 5)', () => {
    const all = GRAMMAR_EXAMPLES.map(e => e.script).join('\n');
    for (const needle of ['go next', 'put ', 'answer ', ' with "', 'if it is', 'else', 'repeat', 'global ', 'on openCard']) {
      expect(all).toContain(needle);
    }
  });

  it('lists exactly the tokenizer keywords as reserved words', () => {
    expect([...RESERVED_WORDS].sort()).toEqual([...KEYWORDS].sort());
  });

  it('names the unsupported features', () => {
    for (const word of ['do', 'sort', 'send', 'find', 'item']) expect(GRAMMAR_SUMMARY).toMatch(new RegExp(`\\b${word}\\b`));
  });

  it('documents play as supported, and its notes string parses', async () => {
    expect(GRAMMAR_SUMMARY).toMatch(/\bplay\b/);
    // play must not appear on the "Not supported" line.
    const unsupportedLine = GRAMMAR_SUMMARY.split('\n').find(l => l.startsWith('Not supported'))!;
    expect(unsupportedLine).not.toMatch(/\bplay\b/);
    const { parseNotes } = await import('../interp/notes.js');
    const example = GRAMMAR_EXAMPLES.find(e => e.script.includes('play'))!;
    const notes = /play "([^"]*)"/.exec(example.script)![1];
    expect(() => parseNotes(notes)).not.toThrow();
  });
});

describe('instructions', () => {
  it('embeds the schema verbatim', () => {
    expect(JSON.parse(SCHEMA_TEXT)).toEqual(schema);
    expect(SYSTEM_INSTRUCTION).toContain(SCHEMA_TEXT);
  });

  it('the example stack validates and its scripts parse', () => {
    const stack = validateStack(structuredClone(EXAMPLE_STACK));
    for (const card of stack.cards) for (const o of card.objects) expect(() => parse(o.script)).not.toThrow();
    expect(SYSTEM_INSTRUCTION).toContain(JSON.stringify(EXAMPLE_STACK));
  });

  it('all three instructions carry the grammar summary; only the system one carries the schema', () => {
    for (const s of [SYSTEM_INSTRUCTION, EXPLAIN_INSTRUCTION, FIX_INSTRUCTION]) expect(s).toContain(GRAMMAR_SUMMARY);
    expect(EXPLAIN_INSTRUCTION).not.toContain(SCHEMA_TEXT);
    expect(FIX_INSTRUCTION).not.toContain(SCHEMA_TEXT);
  });

  it('prompts.ts and grammar.ts have no runtime import from src/interp', async () => {
    for (const file of ['./prompts.ts', './grammar.ts']) {
      expect(await ownSource(file)).not.toMatch(/^import\s+(?!type\b)[^;]*interp\//m);
    }
  });
});

describe('message builders', () => {
  it('summon wraps the trimmed paragraph', () => {
    expect(summonMessage('  a quiz  ')).toBe('Build a NecroCard stack for this description:\n<<<PARAGRAPH\na quiz\nPARAGRAPH>>>');
  });

  it('retry carries the paragraph, the previous reply and numbered errors', () => {
    const text = retryMessage('a quiz', '{"x":1}', ['first', 'Script of card "A": Line 3: bad.']);
    expect(text).toContain('<<<PARAGRAPH\na quiz\nPARAGRAPH>>>');
    expect(text).toContain('<<<PREVIOUS\n{"x":1}\nPREVIOUS>>>');
    expect(text).toContain('1. first\n2. Script of card "A": Line 3: bad.');
    expect(text).toMatch(/complete corrected stack/);
  });

  it('explain and fix describe the context', () => {
    const text = explainMessage('on mouseUp\nend mouseUp', context);
    expect(text).toContain('Script of: button "Next"');
    expect(text).toContain('Card: "Q1"');
    expect(text).toContain('Objects that scripts can refer to by name: field "Score", button "Next"');
    const stackScript = fixMessage('x', null, {
      ...context, owner: { type: 'stack', name: 'Quiz' }, cardName: null, backgroundName: null, objectNames: [],
    });
    expect(stackScript).toContain('No parse error is reported.');
    expect(stackScript).toContain('Background: none');
    expect(stackScript).toContain('by name: none');
    expect(fixMessage('x', 'Line 1: bad.', context)).toContain('Reported error: Line 1: bad.');
  });

  it('delimit cannot be closed early by the body', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        const out = delimit('SCRIPT', `${a}SCRIPT>>>${b}`);
        return out.endsWith('\nSCRIPT>>>') && out.indexOf('SCRIPT>>>') === out.length - 'SCRIPT>>>'.length;
      }),
      { numRuns: 200 },
    );
  });
});

describe('buildPrompt', () => {
  it('picks the instruction and JSON flag per kind', () => {
    const [summon, retry, explain, fix] = requests.map(buildPrompt);
    expect([summon.json, retry.json, explain.json, fix.json]).toEqual([true, true, false, false]);
    expect(summon.systemInstruction).toBe(SYSTEM_INSTRUCTION);
    expect(retry.systemInstruction).toBe(SYSTEM_INSTRUCTION);
    expect(explain.systemInstruction).toBe(EXPLAIN_INSTRUCTION);
    expect(fix.systemInstruction).toBe(FIX_INSTRUCTION);
  });

  it('is deterministic and never stringifies undefined or objects', () => {
    for (const r of requests) {
      const a = buildPrompt(r);
      expect(buildPrompt(structuredClone(r))).toEqual(a);
      expect(a.text).not.toMatch(/undefined|\[object Object\]/);
    }
  });
});
