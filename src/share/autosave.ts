// Autosave the open stack to localStorage, and decide what to load on page start (sharing REQ-2).
// Imports only src/model/. Autosave captures person actions, never script dispatches (REQ-2.1).
import type { FixtureName } from '../model/fixtures.js';
import { serializeStack } from '../model/serialize.js';
import type { Stack } from '../model/types.js';
import { validateStack } from '../model/validate.js';

export const AUTOSAVE_KEY = 'necrocard.autosave';
/** The URL-fragment parameter that carries a shared stack: #s=<encoded>. */
export const FRAGMENT_PARAM = 's';
export const DEFAULT_DEBOUNCE_MS = 500;

/** Fixture keys recognised in a ?stack= link. Kept here so src/share/ imports only src/model/. */
const FIXTURE_KEYS: readonly FixtureName[] = ['quiz', 'adventure', 'flashcards'];
const DEFAULT_FIXTURE: FixtureName = 'quiz';
const isFixtureKey = (value: string): value is FixtureName => (FIXTURE_KEYS as readonly string[]).includes(value);

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export interface Autosave {
  /** Debounced save (trailing). Rapid edits coalesce into one write. */
  save(stack: Stack): void;
  /** Flush any pending debounced save, then write this stack synchronously. */
  saveNow(stack: Stack): void;
  /** Write a pending debounced value now (page hide); no-op if none is pending. */
  flush(): void;
}

export function createAutosave(storage: StorageLike, delay: number = DEFAULT_DEBOUNCE_MS): Autosave {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Stack | null = null;

  const write = (stack: Stack): void => {
    try {
      storage.setItem(AUTOSAVE_KEY, serializeStack(stack));
    } catch {
      // Storage full or unavailable (privacy mode): drop the write silently.
    }
  };
  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  };

  return {
    save(stack) {
      pending = stack;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (pending) write(pending);
        pending = null;
      }, delay);
    },
    saveNow(stack) {
      clear();
      write(stack);
    },
    flush() {
      if (pending) {
        const stack = pending;
        clear();
        write(stack);
      }
    },
  };
}

export type InitialLoad =
  | { source: 'share'; encoded: string }
  | { source: 'fixture'; key: FixtureName }
  | { source: 'autosave'; stack: Stack }
  | { source: 'default' };

export interface InitialChoice {
  load: InitialLoad;
  /** True only when an autosave value was present but could not be read (REQ-2.3 status message). */
  corruptAutosave: boolean;
}

/** The stored stack, or null if absent/unreadable; `corrupt` distinguishes "absent" from "present but bad". */
export function readAutosave(storage: StorageLike): { stack: Stack | null; corrupt: boolean } {
  let raw: string | null;
  try {
    raw = storage.getItem(AUTOSAVE_KEY);
  } catch {
    return { stack: null, corrupt: false }; // storage unavailable: not a corrupt value
  }
  if (raw === null || raw.trim() === '') return { stack: null, corrupt: false };
  try {
    return { stack: validateStack(JSON.parse(raw)), corrupt: false };
  } catch {
    return { stack: null, corrupt: true };
  }
}

/**
 * Decide the page-load source (REQ-2.2): share fragment, then ?stack= fixture, then autosave, then the quiz.
 * The share fragment is returned un-decoded (decoding is async); main.ts decodes it.
 */
export function chooseInitialLoad(location: { search: string; hash: string }, storage: StorageLike): InitialChoice {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
  const encoded = fragment.get(FRAGMENT_PARAM);
  if (encoded !== null && encoded.trim() !== '') {
    return { load: { source: 'share', encoded }, corruptAutosave: false };
  }
  // An explicit ?stack=<fixture> link beats the autosave; a missing/unknown value does not.
  const stackParam = new URLSearchParams(location.search).get('stack');
  if (stackParam !== null && isFixtureKey(stackParam)) {
    return { load: { source: 'fixture', key: stackParam }, corruptAutosave: false };
  }
  const saved = readAutosave(storage);
  if (saved.stack) return { load: { source: 'autosave', stack: saved.stack }, corruptAutosave: false };
  return { load: { source: 'default' }, corruptAutosave: saved.corrupt };
}

export { DEFAULT_FIXTURE };
