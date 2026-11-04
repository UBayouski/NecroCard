// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import quiz from '../../../fixtures/quiz.necrocard.json' with { type: 'json' };
import type { Stack } from '../../model/types.js';
import type { Library, LibraryEntry, SaveResult } from '../../share/library.js';
import { createPersist, QUOTA_MESSAGE, type OpenTarget } from './persist.js';

const QUIZ = quiz as unknown as Stack;
const rename = (name: string): Stack => ({ ...structuredClone(QUIZ), name });

/** A library stub recording calls, with configurable save/create results. */
function fakeLibrary(over: Partial<Library> = {}) {
  const calls = { save: [] as { id: string; name: string }[], create: [] as string[] };
  const entry = (id: string, name: string): LibraryEntry =>
    ({ id, name, stackName: name, createdAt: '', updatedAt: '', stack: QUIZ });
  const base: Library = {
    list: () => [],
    open: () => null,
    create: (stack, name): SaveResult => { calls.create.push(name); return { ok: true, entry: entry('new1', name) }; },
    save: (id, stack): SaveResult => { calls.save.push({ id, name: stack.name }); return { ok: true, entry: entry(id, stack.name) }; },
    delete: () => {},
    lastOpened: () => null,
    setLastOpened: () => {},
    ...over,
  };
  return { library: base, calls };
}

function setup(initialTarget: OpenTarget, over: Partial<Library> = {}, stack: Stack = QUIZ) {
  const { library, calls } = fakeLibrary(over);
  let target = initialTarget;
  const events = { forks: [] as LibraryEntry[], changed: 0, status: [] as string[] };
  const persist = createPersist({
    library,
    currentStack: () => stack,
    showStatus: m => events.status.push(m),
    getTarget: () => target,
    setTarget: t => { target = t; },
    onFork: e => events.forks.push(e),
    onLibraryChanged: () => { events.changed++; },
    delay: 500,
  });
  return { persist, calls, events, target: () => target };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createPersist: entry open', () => {
  it('debounces rapid authored edits into one save', () => {
    const { persist, calls } = setup({ kind: 'entry', id: 'e1' });
    persist.persist('authored');
    persist.persist('authored');
    persist.persist('authored');
    expect(calls.save).toEqual([]);
    vi.advanceTimersByTime(500);
    expect(calls.save).toHaveLength(1);
    expect(calls.save[0].id).toBe('e1');
  });

  it('flush writes the pending save immediately', () => {
    const { persist, calls } = setup({ kind: 'entry', id: 'e1' });
    persist.persist('authored');
    persist.flush();
    expect(calls.save).toHaveLength(1);
    vi.advanceTimersByTime(500); // the timer must not double-write
    expect(calls.save).toHaveLength(1);
  });

  it('Browse-field typing on an entry also saves', () => {
    const { persist, calls } = setup({ kind: 'entry', id: 'e1' });
    persist.persist('browse-typing');
    vi.advanceTimersByTime(500);
    expect(calls.save).toHaveLength(1);
  });

  it('a quota failure on save shows the message', () => {
    const { persist, events } = setup(
      { kind: 'entry', id: 'e1' },
      { save: () => ({ ok: false, reason: 'quota' }) },
    );
    persist.persist('authored');
    vi.advanceTimersByTime(500);
    expect(events.status).toEqual([QUOTA_MESSAGE]);
  });

  it('a save refreshes the picker (name may have been re-derived)', () => {
    const { persist, events } = setup({ kind: 'entry', id: 'e1' });
    persist.persist('authored');
    vi.advanceTimersByTime(500);
    expect(events.changed).toBe(1);
  });
});

describe('createPersist: sample open', () => {
  it('an authored edit forks a (your copy) entry once and flips the target', () => {
    const { persist, calls, events, target } = setup({ kind: 'sample' }, {}, rename('The Haunted Quiz'));
    persist.persist('authored');
    expect(calls.create).toEqual(['The Haunted Quiz (your copy)']);
    expect(events.forks).toHaveLength(1);
    expect(target()).toEqual({ kind: 'entry', id: 'new1' });
    // A second authored edit now saves to the new entry, not fork again.
    persist.persist('authored');
    vi.advanceTimersByTime(500);
    expect(calls.create).toHaveLength(1);
    expect(calls.save).toHaveLength(1);
  });

  it('Browse-field typing on a sample does nothing (no fork)', () => {
    const { persist, calls, target } = setup({ kind: 'sample' });
    persist.persist('browse-typing');
    expect(calls.create).toEqual([]);
    expect(target()).toEqual({ kind: 'sample' });
  });

  it('a quota failure on the fork shows the message and stays on the sample', () => {
    const { persist, events, target } = setup(
      { kind: 'sample' },
      { create: () => ({ ok: false, reason: 'quota' }) },
    );
    persist.persist('authored');
    expect(events.status).toEqual([QUOTA_MESSAGE]);
    expect(target()).toEqual({ kind: 'sample' });
  });
});
