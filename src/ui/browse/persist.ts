// Persist person-made edits to the open library entry, or fork a (your copy) entry on the first authored edit of a
// bundled sample (stack-library REQ-2.2, REQ-3). A 500 ms trailing debounce lives here; script dispatches never
// call in. Unit-testable in happy-dom: the library, the current-stack accessor and the status line are injected.
// Imports src/share/ and src/model/ only (src/share/ stays model-only, so this sits under src/ui/).
import type { Stack } from '../../model/types.js';
import { forkName, type Library, type LibraryEntry } from '../../share/library.js';

export const SAVE_DEBOUNCE_MS = 500;
export const QUOTA_MESSAGE = 'Your library is full; that change was not saved.';

/** What is currently open: a bundled sample (no entry yet) or a library entry. */
export type OpenTarget = { kind: 'sample' } | { kind: 'entry'; id: string };

export interface PersistDeps {
  library: Library;
  /** The live working-copy stack, or null if none is loaded. */
  currentStack: () => Stack | null;
  /** Show a one-line status message (quota failures). */
  showStatus: (message: string) => void;
  /** Read and update the open target. A fork flips a sample to the new entry. */
  getTarget: () => OpenTarget;
  setTarget: (target: OpenTarget) => void;
  /** Called on a fork so main.ts can drop the ?stack= link. */
  onFork: (entry: LibraryEntry) => void;
  /** Called after any index change (create/save-that-renamed) so main.ts rebuilds the picker. */
  onLibraryChanged: () => void;
  delay?: number;
}

export interface Persist {
  /** An authored edit (Edit-mode or message box) or Browse-field typing. */
  persist(kind: 'authored' | 'browse-typing'): void;
  /** Write a pending debounced save now (page hide, or before a load). */
  flush(): void;
}

export function createPersist(deps: PersistDeps): Persist {
  const delay = deps.delay ?? SAVE_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingId: string | null = null;
  let pendingStack: Stack | null = null;

  const clear = (): void => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    pendingId = null;
    pendingStack = null;
  };

  const writeNow = (id: string, stack: Stack): void => {
    const r = deps.library.save(id, stack);
    if (r.ok) {
      // A save may re-derive the record name (inspector rename); refresh the picker.
      deps.onLibraryChanged();
    } else if (r.reason === 'quota') {
      deps.showStatus(QUOTA_MESSAGE);
    }
    // 'not-found' means the entry was deleted; silently drop.
  };

  const flush = (): void => {
    if (pendingId !== null && pendingStack !== null) {
      const id = pendingId;
      const stack = pendingStack;
      clear();
      writeNow(id, stack);
    }
  };

  const scheduleSave = (id: string, stack: Stack): void => {
    pendingId = id;
    pendingStack = stack;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (pendingId !== null && pendingStack !== null) writeNow(pendingId, pendingStack);
      pendingId = null;
      pendingStack = null;
    }, delay);
  };

  const fork = (stack: Stack): void => {
    const r = deps.library.create(stack, forkName(stack.name));
    if (!r.ok) {
      deps.showStatus(QUOTA_MESSAGE);
      return; // stay on the sample; the edit lives in the working copy, unsaved
    }
    deps.setTarget({ kind: 'entry', id: r.entry.id });
    deps.onFork(r.entry);
    deps.onLibraryChanged();
  };

  return {
    persist(kind) {
      const stack = deps.currentStack();
      if (!stack) return;
      const target = deps.getTarget();
      if (target.kind === 'entry') {
        scheduleSave(target.id, stack);
        return;
      }
      // A sample is open. Browse typing never forks (REQ-2.2 narrowing); only an authored edit does.
      if (kind === 'browse-typing') return;
      fork(stack);
    },
    flush,
  };
}
