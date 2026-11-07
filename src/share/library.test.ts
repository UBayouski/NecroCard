import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import quiz from '../../fixtures/quiz.necrocard.json' with { type: 'json' };
import adventure from '../../fixtures/adventure.necrocard.json' with { type: 'json' };
import flashcards from '../../fixtures/flashcards.necrocard.json' with { type: 'json' };
import type { Stack } from '../model/types.js';
import {
  chooseInitialLoad, createLibrary, ENTRY_PREFIX, INDEX_KEY, LEGACY_AUTOSAVE_KEY, LIBRARY_VERSION, resolveName, sharedName,
  type LibraryDeps, type StorageLike,
} from './library.js';

const FIXTURES = [quiz, adventure, flashcards] as unknown as Stack[];
const QUIZ = quiz as unknown as Stack;
const rename = (stack: Stack, name: string): Stack => ({ ...structuredClone(stack), name });

function fakeStorage(initial: Record<string, string> = {}, opts: { throwOnSet?: boolean } = {}) {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      if (opts.throwOnSet) throw new Error('quota');
      data[k] = v;
    },
    removeItem: (k: string) => { delete data[k]; },
  } satisfies StorageLike & { data: Record<string, string> };
}

/** A library with a deterministic counter id and a stepped clock. */
function makeLibrary(initial: Record<string, string> = {}, opts: { throwOnSet?: boolean } = {}) {
  const storage = fakeStorage(initial, opts);
  let n = 0;
  let t = 0;
  const deps: LibraryDeps = {
    storage,
    newId: () => `id${++n}`,
    now: () => new Date(1_700_000_000_000 + t++ * 1000).toISOString(),
  };
  return { library: createLibrary(deps), storage, deps };
}

const loc = (search = '', hash = '') => ({ search, hash });

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

const fixtureArb = fc.constantFrom(...FIXTURES).map(f => structuredClone(f));
const nameArb = fc.string({ maxLength: 24 });

describe('library properties', () => {
  it('create then open deep-equals the stack and the name is collision-resolved', () => {
    fc.assert(
      fc.property(fixtureArb, nameArb, (stack, name) => {
        const { library } = makeLibrary();
        const r = library.create(stack, name);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const opened = library.open(r.entry.id);
        expect(opened?.stack).toEqual(stack);
        expect(opened?.name).toBe(name === '' ? '' : name); // first create: no collision
      }),
      { numRuns: 100 },
    );
  });

  it('a sequence of colliding creates yields all-distinct names and every body round-trips', () => {
    fc.assert(
      fc.property(fc.array(fixtureArb, { minLength: 1, maxLength: 8 }), stacks => {
        const { library } = makeLibrary();
        const ids: string[] = [];
        for (const s of stacks) {
          const r = library.create(rename(s, 'Same Name'), 'Same Name');
          expect(r.ok).toBe(true);
          if (r.ok) ids.push(r.entry.id);
        }
        const names = library.list().map(e => e.name);
        expect(new Set(names).size).toBe(names.length);
        for (const id of ids) expect(library.open(id)).not.toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('save then open deep-equals, and the index stays newest-first across create/save/delete', () => {
    fc.assert(
      fc.property(fc.array(fixtureArb, { minLength: 1, maxLength: 6 }), stacks => {
        const { library } = makeLibrary();
        const ids = stacks.map((s, i) => {
          const r = library.create(s, `S${i}`);
          return r.ok ? r.entry.id : '';
        });
        // Re-save the first created entry; it should rise to the top (newest updatedAt).
        const edited = rename(stacks[0], 'S0');
        library.save(ids[0], edited);
        expect(library.open(ids[0])?.stack).toEqual(edited);
        const times = library.list().map(e => e.updatedAt);
        expect([...times]).toEqual([...times].sort().reverse());
        expect(library.list()[0].id).toBe(ids[0]);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// resolveName
// ---------------------------------------------------------------------------

describe('resolveName', () => {
  it('uses the name when free, else appends 2, 3, ...', () => {
    expect(resolveName('Quiz', [])).toBe('Quiz');
    expect(resolveName('Quiz', ['Quiz'])).toBe('Quiz 2');
    expect(resolveName('Quiz', ['Quiz', 'Quiz 2'])).toBe('Quiz 3');
    expect(resolveName('Quiz (your copy)', ['Quiz (your copy)'])).toBe('Quiz (your copy) 2');
  });
});

// ---------------------------------------------------------------------------
// Layout and operations
// ---------------------------------------------------------------------------

describe('sharedName', () => {
  const SAMPLES = ['The Haunted Quiz', 'The Cursed Manor', 'Spooky Flashcards'];

  it('leaves a name nobody uses as it is', () => {
    expect(sharedName('Haunted Candy', SAMPLES)).toBe('Haunted Candy');
  });

  it('adds " (shared)" when the name equals a bundled sample name', () => {
    expect(sharedName('The Cursed Manor', SAMPLES)).toBe('The Cursed Manor (shared)');
  });

  it('adds " (shared)" when the name equals an existing entry name', () => {
    expect(sharedName('Haunted Candy', [...SAMPLES, 'Haunted Candy'])).toBe('Haunted Candy (shared)');
  });

  it('applies the numeric rule on a second collision', () => {
    const taken = [...SAMPLES, 'The Cursed Manor (shared)'];
    expect(sharedName('The Cursed Manor', taken)).toBe('The Cursed Manor (shared) 2');
  });

  it('creates entries whose names never repeat a sample or another entry', () => {
    const { library } = makeLibrary();
    const incoming = ['The Haunted Quiz', 'The Haunted Quiz', 'Crypt', 'Crypt', 'The Cursed Manor'];
    for (const name of incoming) {
      const taken = [...SAMPLES, ...library.list().map(r => r.name)];
      expect(library.create(rename(QUIZ, name), sharedName(name, taken)).ok).toBe(true);
    }
    const names = library.list().map(r => r.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.some(n => SAMPLES.includes(n))).toBe(false);
    expect(names).toContain('The Haunted Quiz (shared)');
    expect(names).toContain('The Haunted Quiz (shared) 2');
    expect(names).toContain('Crypt');
    expect(names).toContain('Crypt (shared)');
  });
});

describe('library layout and operations', () => {
  it('stores one index key with a version, and one body key per entry', () => {
    const { library, storage } = makeLibrary();
    const r = library.create(QUIZ, 'My Quiz');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const index = JSON.parse(storage.data[INDEX_KEY]);
    expect(index.version).toBe(LIBRARY_VERSION);
    expect(index.entries).toHaveLength(1);
    expect(storage.data[`${ENTRY_PREFIX}${r.entry.id}`]).toBeTypeOf('string');
    expect(index.entries[0].stackName).toBe('The Haunted Quiz');
  });

  it('lists newest-first', () => {
    const { library } = makeLibrary();
    library.create(QUIZ, 'A');
    library.create(QUIZ, 'B');
    library.create(QUIZ, 'C');
    expect(library.list().map(e => e.name)).toEqual(['C', 'B', 'A']);
  });

  it('save to a missing id is not-found, never a throw', () => {
    const { library } = makeLibrary();
    expect(library.save('nope', QUIZ)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('delete removes the body and record and clears last-open when it was that entry', () => {
    const { library, storage } = makeLibrary();
    const r = library.create(QUIZ, 'X');
    if (!r.ok) return;
    expect(library.lastOpened()).toEqual({ kind: 'entry', id: r.entry.id });
    library.delete(r.entry.id);
    expect(library.list()).toEqual([]);
    expect(storage.data[`${ENTRY_PREFIX}${r.entry.id}`]).toBeUndefined();
    expect(library.lastOpened()).toBeNull();
  });

  it('setLastOpened stores a fixture or entry pointer', () => {
    const { library } = makeLibrary();
    library.setLastOpened({ kind: 'fixture', key: 'adventure' });
    expect(library.lastOpened()).toEqual({ kind: 'fixture', key: 'adventure' });
  });
});

// ---------------------------------------------------------------------------
// Name re-derivation on save (REQ-4.2)
// ---------------------------------------------------------------------------

describe('save name re-derivation', () => {
  it('re-derives the record name when stack.name changed, keeps it otherwise', () => {
    const { library } = makeLibrary();
    const r = library.create(QUIZ, 'The Haunted Quiz (your copy)');
    if (!r.ok) return;
    // Same stack.name: label unchanged (keeps the "(your copy)" display name).
    library.save(r.entry.id, QUIZ);
    expect(library.list()[0].name).toBe('The Haunted Quiz (your copy)');
    // Changed stack.name: label follows it.
    library.save(r.entry.id, rename(QUIZ, 'My Spooky Deck'));
    expect(library.list()[0].name).toBe('My Spooky Deck');
  });

  it('collides the re-derived name against other entries', () => {
    const { library } = makeLibrary();
    library.create(rename(QUIZ, 'Taken'), 'Taken');
    const r = library.create(rename(QUIZ, 'Other'), 'Other');
    if (!r.ok) return;
    library.save(r.entry.id, rename(QUIZ, 'Taken'));
    expect(library.list().find(e => e.id === r.entry.id)?.name).toBe('Taken 2');
  });
});

// ---------------------------------------------------------------------------
// Storage failure (REQ-1.5)
// ---------------------------------------------------------------------------

describe('storage failure', () => {
  it('create returns quota and leaves no dangling index record', () => {
    const { library, storage } = makeLibrary({}, { throwOnSet: true });
    expect(library.create(QUIZ, 'X')).toEqual({ ok: false, reason: 'quota' });
    expect(storage.data[INDEX_KEY]).toBeUndefined();
  });

  it('save returns quota when the write fails', () => {
    // A storage that allows the create, then throws on subsequent sets.
    const data: Record<string, string> = {};
    let fail = false;
    const storage: StorageLike = {
      getItem: k => (k in data ? data[k] : null),
      setItem: (k, v) => { if (fail) throw new Error('quota'); data[k] = v; },
      removeItem: k => { delete data[k]; },
    };
    let n = 0;
    const library = createLibrary({ storage, newId: () => `id${++n}`, now: () => new Date(0).toISOString() });
    const r = library.create(QUIZ, 'X');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    fail = true;
    expect(library.save(r.entry.id, rename(QUIZ, 'Edited'))).toEqual({ ok: false, reason: 'quota' });
  });
});

// ---------------------------------------------------------------------------
// Corrupt / unknown index and bodies
// ---------------------------------------------------------------------------

describe('corrupt values', () => {
  it('an unparseable index reads as empty', () => {
    const { library } = makeLibrary({ [INDEX_KEY]: 'not json' });
    expect(library.list()).toEqual([]);
    expect(library.lastOpened()).toBeNull();
  });

  it('an unknown version reads as empty', () => {
    const { library } = makeLibrary({ [INDEX_KEY]: JSON.stringify({ version: 999, entries: [] }) });
    expect(library.list()).toEqual([]);
  });

  it('open of a record whose body is missing returns null', () => {
    const { library, storage } = makeLibrary();
    const r = library.create(QUIZ, 'X');
    if (!r.ok) return;
    delete storage.data[`${ENTRY_PREFIX}${r.entry.id}`];
    expect(library.open(r.entry.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// chooseInitialLoad and migration (REQ-5)
// ---------------------------------------------------------------------------

describe('chooseInitialLoad', () => {
  it('a share fragment wins over everything', () => {
    const { deps } = makeLibrary();
    const choice = chooseInitialLoad(loc('', '#s=ABC'), deps);
    expect(choice.load).toEqual({ source: 'share', encoded: 'ABC' });
  });

  it('?stack= beats the last-open and sets last-open to that sample', () => {
    const { deps, library } = makeLibrary();
    const choice = chooseInitialLoad(loc('?stack=adventure'), deps);
    expect(choice.load).toEqual({ source: 'fixture', key: 'adventure' });
    expect(library.lastOpened()).toEqual({ kind: 'fixture', key: 'adventure' });
  });

  it('with no fragment or query, a last-open entry reopens; a deleted one falls through to the quiz', () => {
    const { deps, library } = makeLibrary();
    const r = library.create(QUIZ, 'Kept');
    if (!r.ok) return;
    let choice = chooseInitialLoad(loc(), deps);
    expect(choice.load.source).toBe('library');
    if (choice.load.source === 'library') expect(choice.load.entry.id).toBe(r.entry.id);

    library.delete(r.entry.id);
    choice = chooseInitialLoad(loc(), deps);
    expect(choice.load).toEqual({ source: 'default' });
  });

  it('a last-open fixture reopens as that sample', () => {
    const { deps, library } = makeLibrary();
    library.setLastOpened({ kind: 'fixture', key: 'flashcards' });
    expect(chooseInitialLoad(loc(), deps).load).toEqual({ source: 'fixture', key: 'flashcards' });
  });

  it('nothing stored opens the quiz', () => {
    const { deps } = makeLibrary();
    expect(chooseInitialLoad(loc(), deps).load).toEqual({ source: 'default' });
  });
});

describe('legacy migration', () => {
  it('imports a legacy autosave once as a (your copy) entry, removes the key, and reopens it', () => {
    const legacy = JSON.stringify(rename(QUIZ, 'The Haunted Quiz'));
    const { deps, storage } = makeLibrary({ [LEGACY_AUTOSAVE_KEY]: legacy });
    const choice = chooseInitialLoad(loc(), deps);
    expect(storage.data[LEGACY_AUTOSAVE_KEY]).toBeUndefined();
    expect(choice.load.source).toBe('library');
    if (choice.load.source === 'library') {
      expect(choice.load.entry.name).toBe('The Haunted Quiz (your copy)');
    }
    // A second load does not re-migrate (the key is gone).
    const again = chooseInitialLoad(loc(), deps);
    const lib = createLibrary(deps);
    expect(lib.list()).toHaveLength(1);
    expect(again.load.source).toBe('library');
  });

  it('reports a corrupt legacy value and removes it', () => {
    const { deps, storage } = makeLibrary({ [LEGACY_AUTOSAVE_KEY]: 'not a stack' });
    const choice = chooseInitialLoad(loc(), deps);
    expect(choice.corruptAutosave).toBe(true);
    expect(storage.data[LEGACY_AUTOSAVE_KEY]).toBeUndefined();
    expect(choice.load).toEqual({ source: 'default' });
  });

  it('migrates even when the library already has entries', () => {
    const { deps, library } = makeLibrary();
    library.create(QUIZ, 'Existing');
    const legacy = JSON.stringify(rename(QUIZ, 'Legacy Deck'));
    // Re-create the library over the same storage with the legacy key added.
    deps.storage.setItem(LEGACY_AUTOSAVE_KEY, legacy);
    const choice = chooseInitialLoad(loc(), deps);
    const lib = createLibrary(deps);
    expect(lib.list()).toHaveLength(2);
    expect(choice.load.source).toBe('library');
  });

  it('a corrupt index reads empty and is reported', () => {
    const { deps } = makeLibrary({ [INDEX_KEY]: '{ broken' });
    const choice = chooseInitialLoad(loc(), deps);
    expect(choice.corruptIndex).toBe(true);
    expect(choice.load).toEqual({ source: 'default' });
  });
});
