// The stack library (spec stack-library): a named, multi-entry store in localStorage that supersedes the single
// autosave of `sharing` REQ-2. One index key plus one body key per entry, a version field, entry ids independent
// of the stack's own id, a name-collision suffix rule, a last-open pointer, and a one-time legacy migration.
//
// Pure over an injected StorageLike (whose setItem rethrows so quota is detectable), an injected clock and an
// injected id factory. Imports only src/model/.
import type { FixtureName } from '../model/fixtures.js';
import { generateId } from '../model/id.js';
import { serializeStack } from '../model/serialize.js';
import type { Stack } from '../model/types.js';
import { validateStack } from '../model/validate.js';

export const INDEX_KEY = 'necrocard.library';
export const ENTRY_PREFIX = 'necrocard.library.entry.';
export const LIBRARY_VERSION = 1;

/** Kept for migration; the legacy single-autosave key from `sharing`. */
export const LEGACY_AUTOSAVE_KEY = 'necrocard.autosave';
/** The URL-fragment parameter that carries a shared stack: #s=<encoded>. */
export const FRAGMENT_PARAM = 's';

const FIXTURE_KEYS: readonly FixtureName[] = ['quiz', 'adventure', 'flashcards'];
export const DEFAULT_FIXTURE: FixtureName = 'quiz';
const isFixtureKey = (value: string): value is FixtureName => (FIXTURE_KEYS as readonly string[]).includes(value);

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface LibraryRecord {
  id: string;
  name: string;      // display name, collision-resolved
  stackName: string; // stack.name as of the last save (drives rename detection)
  createdAt: string;
  updatedAt: string;
}
export interface LibraryEntry extends LibraryRecord {
  stack: Stack;
}
export type LastOpened =
  | { kind: 'fixture'; key: FixtureName }
  | { kind: 'entry'; id: string };
export type SaveResult =
  | { ok: true; entry: LibraryEntry }
  | { ok: false; reason: 'quota' | 'not-found' };

export interface Library {
  list(): LibraryRecord[];
  open(id: string): LibraryEntry | null;
  create(stack: Stack, name: string): SaveResult;
  save(id: string, stack: Stack): SaveResult;
  delete(id: string): void;
  lastOpened(): LastOpened | null;
  setLastOpened(target: LastOpened | null): void;
}

export interface LibraryDeps {
  storage: StorageLike;
  now?: () => string;
  newId?: () => string;
}

interface IndexShape {
  version: number;
  entries: LibraryRecord[];
  lastOpened: LastOpened | null;
}

const bodyKey = (id: string): string => `${ENTRY_PREFIX}${id}`;
const emptyIndex = (): IndexShape => ({ version: LIBRARY_VERSION, entries: [], lastOpened: null });

/** Add a numeric suffix until the name is unique; the caller supplies any "(your copy)" base. */
export function resolveName(requested: string, existingNames: Iterable<string>): string {
  const taken = new Set(existingNames);
  if (!taken.has(requested)) return requested;
  for (let n = 2; ; n++) {
    const candidate = `${requested} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function createLibrary(deps: LibraryDeps): Library {
  const { storage } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? generateId;

  /** Parse the index; a missing, unparseable, or unknown-version value reads as empty. */
  function readIndex(): IndexShape {
    let raw: string | null;
    try {
      raw = storage.getItem(INDEX_KEY);
    } catch {
      return emptyIndex();
    }
    if (raw === null || raw.trim() === '') return emptyIndex();
    try {
      const parsed = JSON.parse(raw) as Partial<IndexShape>;
      if (!parsed || parsed.version !== LIBRARY_VERSION || !Array.isArray(parsed.entries)) return emptyIndex();
      return {
        version: LIBRARY_VERSION,
        entries: parsed.entries as LibraryRecord[],
        lastOpened: parsed.lastOpened ?? null,
      };
    } catch {
      return emptyIndex();
    }
  }

  const sortNewest = (entries: LibraryRecord[]): LibraryRecord[] =>
    [...entries].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

  /** Write the index. Throws on a storage failure (caller maps to a quota result). */
  function writeIndex(index: IndexShape): void {
    index.entries = sortNewest(index.entries);
    storage.setItem(INDEX_KEY, JSON.stringify(index));
  }

  function readBody(id: string): Stack | null {
    let raw: string | null;
    try {
      raw = storage.getItem(bodyKey(id));
    } catch {
      return null;
    }
    if (raw === null || raw.trim() === '') return null;
    try {
      return validateStack(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  return {
    list() {
      return sortNewest(readIndex().entries);
    },

    open(id) {
      const record = readIndex().entries.find(e => e.id === id);
      if (!record) return null;
      const stack = readBody(id);
      return stack ? { ...record, stack } : null;
    },

    create(stack, name) {
      const index = readIndex();
      const id = newId();
      const resolved = resolveName(name, index.entries.map(e => e.name));
      const ts = now();
      try {
        storage.setItem(bodyKey(id), serializeStack(stack));
      } catch {
        return { ok: false, reason: 'quota' };
      }
      const record: LibraryRecord = { id, name: resolved, stackName: stack.name, createdAt: ts, updatedAt: ts };
      index.entries.push(record);
      index.lastOpened = { kind: 'entry', id };
      try {
        writeIndex(index);
      } catch {
        try { storage.removeItem(bodyKey(id)); } catch { /* best effort */ }
        return { ok: false, reason: 'quota' };
      }
      return { ok: true, entry: { ...record, stack } };
    },

    save(id, stack) {
      const index = readIndex();
      const record = index.entries.find(e => e.id === id);
      if (!record) return { ok: false, reason: 'not-found' };
      try {
        storage.setItem(bodyKey(id), serializeStack(stack));
      } catch {
        return { ok: false, reason: 'quota' };
      }
      record.updatedAt = now();
      if (stack.name !== record.stackName) {
        const others = index.entries.filter(e => e.id !== id).map(e => e.name);
        record.name = resolveName(stack.name, others);
        record.stackName = stack.name;
      }
      try {
        writeIndex(index);
      } catch {
        return { ok: false, reason: 'quota' };
      }
      return { ok: true, entry: { ...record, stack } };
    },

    delete(id) {
      const index = readIndex();
      index.entries = index.entries.filter(e => e.id !== id);
      if (index.lastOpened?.kind === 'entry' && index.lastOpened.id === id) index.lastOpened = null;
      try { storage.removeItem(bodyKey(id)); } catch { /* best effort */ }
      try { writeIndex(index); } catch { /* a stale record is harmless; open() drops a dead body */ }
    },

    lastOpened() {
      return readIndex().lastOpened;
    },

    setLastOpened(target) {
      const index = readIndex();
      index.lastOpened = target;
      try { writeIndex(index); } catch { /* a pointer, not data: a dropped write only forgets the reopen target */ }
    },
  };
}

// ---------------------------------------------------------------------------
// Page-load decision and legacy migration (REQ-5)
// ---------------------------------------------------------------------------

export type InitialLoad =
  | { source: 'share'; encoded: string }
  | { source: 'fixture'; key: FixtureName }
  | { source: 'library'; entry: LibraryEntry }
  | { source: 'default' };

export interface InitialChoice {
  load: InitialLoad;
  corruptAutosave: boolean;
  corruptIndex: boolean;
}

/** The "(your copy)" display base used by the fork and the migration. */
export function forkName(stackName: string): string {
  return `${stackName} (your copy)`;
}

/**
 * Migrate a legacy single-autosave value into the library once, then remove the key. Runs whenever the key
 * exists. A corrupt value is removed and reported. A quota failure keeps the key (data not lost) so it retries.
 * Returns whether the migrated value was corrupt.
 */
function migrateLegacy(library: Library, storage: StorageLike): { corruptAutosave: boolean } {
  let raw: string | null;
  try {
    raw = storage.getItem(LEGACY_AUTOSAVE_KEY);
  } catch {
    return { corruptAutosave: false };
  }
  if (raw === null || raw.trim() === '') return { corruptAutosave: false };
  let stack: Stack;
  try {
    stack = validateStack(JSON.parse(raw));
  } catch {
    try { storage.removeItem(LEGACY_AUTOSAVE_KEY); } catch { /* best effort */ }
    return { corruptAutosave: true };
  }
  const result = library.create(stack, forkName(stack.name));
  if (result.ok) {
    try { storage.removeItem(LEGACY_AUTOSAVE_KEY); } catch { /* best effort */ }
  }
  // On quota failure, keep the legacy key so no data is lost; migration retries next load.
  return { corruptAutosave: false };
}

/**
 * Decide the page-load source (REQ-5.1): share fragment, then ?stack= fixture, then the last-open stack (sample or
 * entry), then the quiz. Runs the one-time legacy migration first. The share fragment is returned un-decoded.
 */
export function chooseInitialLoad(
  location: { search: string; hash: string },
  deps: LibraryDeps,
): InitialChoice {
  const library = createLibrary(deps);

  // corruptIndex: the index key is present but unreadable/unknown-version (reads as empty). Check before migration,
  // since migration writes a fresh valid index.
  let corruptIndex = false;
  try {
    const rawIndex = deps.storage.getItem(INDEX_KEY);
    if (rawIndex !== null && rawIndex.trim() !== '') {
      try {
        const parsed = JSON.parse(rawIndex) as Partial<IndexShape>;
        if (!parsed || parsed.version !== LIBRARY_VERSION || !Array.isArray(parsed.entries)) corruptIndex = true;
      } catch {
        corruptIndex = true;
      }
    }
  } catch {
    /* storage unavailable: treated as empty, no message */
  }

  const { corruptAutosave } = migrateLegacy(library, deps.storage);

  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
  const encoded = fragment.get(FRAGMENT_PARAM);
  if (encoded !== null && encoded.trim() !== '') {
    return { load: { source: 'share', encoded }, corruptAutosave, corruptIndex };
  }

  const stackParam = new URLSearchParams(location.search).get('stack');
  if (stackParam !== null && isFixtureKey(stackParam)) {
    library.setLastOpened({ kind: 'fixture', key: stackParam });
    return { load: { source: 'fixture', key: stackParam }, corruptAutosave, corruptIndex };
  }

  const last = library.lastOpened();
  if (last?.kind === 'entry') {
    const entry = library.open(last.id);
    if (entry) return { load: { source: 'library', entry }, corruptAutosave, corruptIndex };
  } else if (last?.kind === 'fixture') {
    return { load: { source: 'fixture', key: last.key }, corruptAutosave, corruptIndex };
  }

  return { load: { source: 'default' }, corruptAutosave, corruptIndex };
}
