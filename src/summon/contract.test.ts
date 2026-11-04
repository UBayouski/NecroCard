import { describe, expect, it } from 'vitest';
import type { ScriptContext } from './agentClient.js';
import { LIMITS, parseSummonRequest, SERVER_ERROR_KINDS } from './contract.js';

const context: ScriptContext = {
  owner: { type: 'button', name: 'Next' },
  stackName: 'Quiz',
  cardName: 'Q1',
  backgroundName: 'Main',
  objectNames: [{ type: 'field', name: 'Score' }],
};

const valid = {
  summon: { kind: 'summon', payload: { prompt: 'a two-card quiz' } },
  retry: { kind: 'retry', payload: { prompt: 'a quiz', previous: '{}', errors: ['Schema: (root) bad'] } },
  explain: { kind: 'explain', payload: { script: 'on mouseUp\n  beep\nend mouseUp', context } },
  fix: { kind: 'fix', payload: { script: 'on mouseUp\nend click', error: 'Line 2: x.', context } },
};

const problemsOf = (value: unknown): string[] => {
  const result = parseSummonRequest(value);
  return result.ok ? [] : result.problems;
};

const withPayload = (base: { kind: string; payload: object }, patch: object) => ({
  kind: base.kind,
  payload: { ...base.payload, ...patch },
});

describe('parseSummonRequest', () => {
  it.each(Object.entries(valid))('accepts a valid %s request and returns it unchanged', (_kind, request) => {
    const result = parseSummonRequest(request);
    expect(result).toEqual({ ok: true, request });
  });

  it('accepts fix with a null error and cards/backgrounds of null', () => {
    const request = withPayload(valid.fix, {
      error: null,
      context: { ...context, owner: { type: 'stack', name: 'Quiz' }, cardName: null, backgroundName: null },
    });
    expect(parseSummonRequest(request).ok).toBe(true);
  });

  it.each([null, 3, 'x', [], undefined])('rejects a non-object body %p', value => {
    expect(problemsOf(value)).toEqual(['The request must be a JSON object']);
  });

  it('rejects an unknown kind and a missing payload', () => {
    expect(problemsOf({ kind: 'chat', payload: {} })).toEqual(['kind must be one of summon, retry, explain, fix']);
    expect(problemsOf({ kind: 'summon' })).toEqual(['payload must be an object']);
  });

  it('rejects unknown keys at every level', () => {
    expect(problemsOf({ ...valid.summon, model: 'gemini-pro' })).toEqual(['The request has an unknown key "model"']);
    expect(problemsOf(withPayload(valid.summon, { systemInstruction: 'x' }))).toEqual([
      'payload has an unknown key "systemInstruction"',
    ]);
    expect(problemsOf(withPayload(valid.explain, { context: { ...context, extra: 1 } }))).toEqual([
      'payload.context has an unknown key "extra"',
    ]);
    expect(
      problemsOf(withPayload(valid.explain, { context: { ...context, owner: { type: 'button', name: 'a', id: 'x' } } })),
    ).toEqual(['payload.context.owner has an unknown key "id"']);
    expect(
      problemsOf(withPayload(valid.explain, { context: { ...context, objectNames: [{ type: 'field', name: 'a', x: 1 }] } })),
    ).toEqual(['payload.context.objectNames[0] has an unknown key "x"']);
  });

  it('clips long unknown keys', () => {
    const key = 'k'.repeat(100);
    expect(problemsOf({ ...valid.summon, [key]: 1 })[0]).toBe(`The request has an unknown key "${'k'.repeat(40)}…"`);
  });

  it('rejects an empty or whitespace prompt', () => {
    expect(problemsOf(withPayload(valid.summon, { prompt: '   ' }))).toEqual(['payload.prompt must not be empty']);
  });

  it('rejects wrong field types', () => {
    expect(problemsOf(withPayload(valid.summon, { prompt: 5 }))).toEqual(['payload.prompt must be a string']);
    expect(problemsOf(withPayload(valid.retry, { errors: 'x' }))).toEqual(['payload.errors must be an array']);
    expect(problemsOf(withPayload(valid.retry, { errors: [1] }))).toEqual(['payload.errors[0] must be a string']);
    expect(problemsOf(withPayload(valid.fix, { error: undefined }))).toEqual(['payload.error must be a string']);
    expect(problemsOf(withPayload(valid.explain, { context: null }))).toEqual(['payload.context must be an object']);
    expect(problemsOf(withPayload(valid.explain, { context: { ...context, cardName: undefined } }))).toEqual([
      'payload.context.cardName must be a string',
    ]);
    expect(problemsOf(withPayload(valid.explain, { context: { ...context, objectNames: {} } }))).toEqual([
      'payload.context.objectNames must be an array',
    ]);
    expect(problemsOf(withPayload(valid.explain, { context: { ...context, objectNames: ['x'] } }))).toEqual([
      'payload.context.objectNames[0] must be an object',
    ]);
  });

  it('rejects enum values outside the owner and object types', () => {
    expect(
      problemsOf(withPayload(valid.explain, { context: { ...context, owner: { type: 'menu', name: 'a' } } })),
    ).toEqual(['payload.context.owner.type must be one of button, field, image, card, background, stack']);
    expect(
      problemsOf(withPayload(valid.explain, { context: { ...context, objectNames: [{ type: 'card', name: 'a' }] } })),
    ).toEqual(['payload.context.objectNames[0].type must be one of button, field, image']);
  });

  describe('limits (at the limit passes, one over fails)', () => {
    const cases: [string, (n: number) => unknown, number, string][] = [
      ['prompt', n => withPayload(valid.summon, { prompt: 'a'.repeat(n) }), LIMITS.prompt, 'payload.prompt'],
      ['previous', n => withPayload(valid.retry, { previous: 'a'.repeat(n) }), LIMITS.previous, 'payload.previous'],
      ['error line', n => withPayload(valid.retry, { errors: ['a'.repeat(n)] }), LIMITS.errorLine, 'payload.errors[0]'],
      ['script', n => withPayload(valid.explain, { script: 'a'.repeat(n) }), LIMITS.script, 'payload.script'],
      ['fix error', n => withPayload(valid.fix, { error: 'a'.repeat(n) }), LIMITS.error, 'payload.error'],
      [
        'context name',
        n => withPayload(valid.explain, { context: { ...context, stackName: 'a'.repeat(n) } }),
        LIMITS.contextName,
        'payload.context.stackName',
      ],
    ];
    it.each(cases)('%s', (_name, make, limit, where) => {
      expect(parseSummonRequest(make(limit)).ok).toBe(true);
      expect(problemsOf(make(limit + 1))).toEqual([`${where} must be at most ${limit} characters`]);
    });

    it('error count', () => {
      const errors = (n: number) => withPayload(valid.retry, { errors: Array.from({ length: n }, () => 'e') });
      expect(parseSummonRequest(errors(LIMITS.errors)).ok).toBe(true);
      expect(problemsOf(errors(LIMITS.errors + 1))).toEqual([`payload.errors must have at most ${LIMITS.errors} items`]);
    });

    it('object name count', () => {
      const objects = (n: number) =>
        withPayload(valid.explain, {
          context: { ...context, objectNames: Array.from({ length: n }, () => ({ type: 'button', name: 'b' })) },
        });
      expect(parseSummonRequest(objects(LIMITS.contextObjects)).ok).toBe(true);
      expect(problemsOf(objects(LIMITS.contextObjects + 1))).toEqual([
        `payload.context.objectNames must have at most ${LIMITS.contextObjects} items`,
      ]);
    });
  });

  it('lists every problem at once', () => {
    expect(problemsOf({ kind: 'retry', payload: { prompt: '', previous: 1, errors: null } })).toEqual([
      'payload.prompt must not be empty',
      'payload.previous must be a string',
      'payload.errors must be an array',
    ]);
  });

  it('names twelve server error kinds', () => {
    expect(new Set(SERVER_ERROR_KINDS).size).toBe(12);
  });
});
