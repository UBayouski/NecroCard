// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import quiz from '../../fixtures/quiz.necrocard.json' with { type: 'json' };
import { serializeStack } from '../model/serialize.js';
import type { Stack } from '../model/types.js';
import {
  AUTOSAVE_KEY, chooseInitialLoad, createAutosave, FRAGMENT_PARAM, readAutosave, type StorageLike,
} from './autosave.js';

const QUIZ = quiz as unknown as Stack;
const rename = (stack: Stack, name: string): Stack => ({ ...structuredClone(stack), name });

function fakeStorage(initial: Record<string, string> = {}, opts: { throwOnSet?: boolean; throwOnGet?: boolean } = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => {
      if (opts.throwOnGet) throw new Error('unavailable');
      return k in data ? data[k] : null;
    },
    setItem: (k: string, v: string) => {
      if (opts.throwOnSet) throw new Error('quota');
      data[k] = v;
    },
  } satisfies StorageLike & { data: Record<string, string> };
}

const loc = (search = '', hash = '') => ({ search, hash });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createAutosave', () => {
  it('coalesces rapid saves into one write after the debounce', () => {
    const storage = fakeStorage();
    const autosave = createAutosave(storage, 500);
    autosave.save(rename(QUIZ, 'A'));
    autosave.save(rename(QUIZ, 'B'));
    autosave.save(rename(QUIZ, 'C'));
    expect(storage.data[AUTOSAVE_KEY]).toBeUndefined();
    vi.advanceTimersByTime(499);
    expect(storage.data[AUTOSAVE_KEY]).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(JSON.parse(storage.data[AUTOSAVE_KEY]).name).toBe('C');
  });

  it('saveNow flushes the pending timer and writes immediately', () => {
    const storage = fakeStorage();
    const autosave = createAutosave(storage, 500);
    autosave.save(rename(QUIZ, 'debounced'));
    autosave.saveNow(rename(QUIZ, 'now'));
    expect(JSON.parse(storage.data[AUTOSAVE_KEY]).name).toBe('now');
    vi.advanceTimersByTime(500); // the superseded debounce must not fire a second write
    expect(JSON.parse(storage.data[AUTOSAVE_KEY]).name).toBe('now');
  });

  it('flush writes a pending value and does nothing when none is pending', () => {
    const storage = fakeStorage();
    const autosave = createAutosave(storage, 500);
    autosave.flush();
    expect(storage.data[AUTOSAVE_KEY]).toBeUndefined();
    autosave.save(rename(QUIZ, 'pending'));
    autosave.flush();
    expect(JSON.parse(storage.data[AUTOSAVE_KEY]).name).toBe('pending');
    vi.advanceTimersByTime(500);
    expect(JSON.parse(storage.data[AUTOSAVE_KEY]).name).toBe('pending');
  });

  it('writes the canonical serialization', () => {
    const storage = fakeStorage();
    createAutosave(storage, 0).saveNow(QUIZ);
    expect(storage.data[AUTOSAVE_KEY]).toBe(serializeStack(QUIZ));
  });

  it('a throwing setItem is swallowed', () => {
    const storage = fakeStorage({}, { throwOnSet: true });
    expect(() => createAutosave(storage, 0).saveNow(QUIZ)).not.toThrow();
  });
});

describe('readAutosave', () => {
  it('returns the stack when present and valid', () => {
    const storage = fakeStorage({ [AUTOSAVE_KEY]: serializeStack(QUIZ) });
    expect(readAutosave(storage)).toEqual({ stack: QUIZ, corrupt: false });
  });

  it('absent → not corrupt; present but bad → corrupt', () => {
    expect(readAutosave(fakeStorage())).toEqual({ stack: null, corrupt: false });
    expect(readAutosave(fakeStorage({ [AUTOSAVE_KEY]: 'not json' }))).toEqual({ stack: null, corrupt: true });
    expect(readAutosave(fakeStorage({ [AUTOSAVE_KEY]: '{"name":"x"}' }))).toEqual({ stack: null, corrupt: true });
  });

  it('unavailable storage → not corrupt', () => {
    expect(readAutosave(fakeStorage({}, { throwOnGet: true }))).toEqual({ stack: null, corrupt: false });
  });
});

describe('chooseInitialLoad priority', () => {
  const saved = () => fakeStorage({ [AUTOSAVE_KEY]: serializeStack(rename(QUIZ, 'Saved')) });

  it('1. a share fragment wins over everything, returned un-decoded', () => {
    const choice = chooseInitialLoad(loc('?stack=adventure', `#${FRAGMENT_PARAM}=ABC123`), saved());
    expect(choice.load).toEqual({ source: 'share', encoded: 'ABC123' });
  });

  it('2. a ?stack= fixture beats the autosave', () => {
    const choice = chooseInitialLoad(loc('?stack=adventure', ''), saved());
    expect(choice.load).toEqual({ source: 'fixture', key: 'adventure' });
  });

  it('an unknown ?stack= value does not count as a fixture; the autosave wins', () => {
    const choice = chooseInitialLoad(loc('?stack=../etc', ''), saved());
    expect(choice.load.source).toBe('autosave');
  });

  it('3. the autosave when no share or fixture link', () => {
    const choice = chooseInitialLoad(loc('', ''), saved());
    expect(choice.load).toMatchObject({ source: 'autosave' });
    expect((choice.load as { stack: Stack }).stack.name).toBe('Saved');
  });

  it('4. the default quiz when storage is empty', () => {
    expect(chooseInitialLoad(loc('', ''), fakeStorage()).load).toEqual({ source: 'default' });
  });

  it('a corrupt autosave falls through to default and is flagged', () => {
    const choice = chooseInitialLoad(loc('', ''), fakeStorage({ [AUTOSAVE_KEY]: 'broken' }));
    expect(choice).toEqual({ load: { source: 'default' }, corruptAutosave: true });
  });

  it('an empty fragment value is ignored', () => {
    const choice = chooseInitialLoad(loc('', `#${FRAGMENT_PARAM}=`), fakeStorage());
    expect(choice.load.source).toBe('default');
  });
});

describe('share load leaves the autosave intact (REQ-4.2)', () => {
  it('loading with autosave off writes nothing, so a prior autosave survives', () => {
    const storage = fakeStorage({ [AUTOSAVE_KEY]: serializeStack(rename(QUIZ, 'Mine')) });
    const autosave = createAutosave(storage, 500);
    // Simulate main.ts opening a shared stack with autosave off: no save/saveNow is called.
    // The stored value must be unchanged, and a reload must still choose it.
    expect(JSON.parse(storage.data[AUTOSAVE_KEY]).name).toBe('Mine');
    const reload = chooseInitialLoad(loc('', ''), storage);
    expect((reload.load as { stack: Stack }).stack.name).toBe('Mine');
    // A later person edit does persist.
    autosave.saveNow(rename(QUIZ, 'Edited'));
    expect(JSON.parse(storage.data[AUTOSAVE_KEY]).name).toBe('Edited');
  });
});
