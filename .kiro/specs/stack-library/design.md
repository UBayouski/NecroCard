# stack-library — Design

## 1. Overview

The library replaces the single-value autosave with a named, multi-entry store in `localStorage`. The core is a
pure module, `src/share/library.ts`, that owns the storage layout (one index key, one body key per entry), the
entry ids, the name-collision rule, the last-open pointer, and the legacy migration. Everything stateful lives
behind an injected `StorageLike`, an injected clock, and an injected id factory, so the whole module is
deterministic under test.

`src/main.ts` keeps its existing shape — one `loadStack`, a `chooseInitialLoad` switch, the `onChange` /
message-box / `onFieldEdited` person-action signals — but its autosave target becomes "the open library entry"
instead of "the one autosave value". A small piece of session state, `openTarget`, records whether the open stack
is a bundled sample (no entry yet) or a library entry (an id), and the save signals branch on it: save to the entry,
or fork a `(your copy)` entry from the sample on the first authored edit.

The stack picker grows a second `<optgroup>`, "My stacks", rebuilt from `library.list()` after every create,
delete, or rename. The custom-label logic (`customLabel` in `stackPicker.ts`) is deleted; the library already
stores a resolved, collision-free name, so the picker renders names verbatim.

Two chrome buttons, Delete and Rename, reuse the existing `dialogShell`.

This design satisfies requirements REQ-1 through REQ-10. It supersedes `sharing` REQ-2: `src/share/autosave.ts` is
replaced by `library.ts` (the old file is removed once nothing imports it), and `chooseInitialLoad` moves into the
new module with the redefined priority.

### Module map

| File | Change | Imports |
|---|---|---|
| `src/share/library.ts` | **new** — the library model and `chooseInitialLoad` | `src/model/` only |
| `src/share/autosave.ts` | **removed** — folded into `library.ts` | — |
| `src/ui/browse/stackPicker.ts` | two groups; `customLabel` deleted; `showCustom`/`showUntitled`/transient logic replaced by a rebuild-from-list API | `src/model/` |
| `src/ui/browse/libraryControls.ts` | **new** — the Delete button + its confirm dialog | `src/model/`, `dialogShell` |
| `src/ui/browse/persist.ts` | **new** — debounce + save-to-entry / fork-sample logic, deps injected | `src/share/`, `src/model/` |
| `src/main.ts` | `openTarget` state; wire saves to `library`; initial-load switch; rebuild picker | `src/share/`, `src/ui/`, `src/model/` |
| `src/ui/chrome.css` | Delete/Rename button rules; `<optgroup>` only if `retro-ui.md` needs it | — |
| `docs/BRIEF.md`, `.kiro/steering/product.md` | Task-1 short amendment (REQ-10) | — |

No file under `src/interp/`, `src/model/`, `fixtures/`, `src/summon/` or `server/` changes. No dependency is added.

---

## 2. The library module (`src/share/library.ts`, pure) — REQ-1, REQ-5

### 2.1 Types

```ts
export interface LibraryRecord {          // index metadata, no stack body
  id: string;
  name: string;                           // display name, collision-resolved
  stackName: string;                      // stack.name as of the last save (drives rename detection)
  createdAt: string;                      // ISO
  updatedAt: string;                      // ISO
}
export interface LibraryEntry extends LibraryRecord {
  stack: Stack;
}
export type LastOpened =
  | { kind: 'fixture'; key: FixtureName }
  | { kind: 'entry'; id: string };
export type SaveResult = { ok: true; entry: LibraryEntry } | { ok: false; reason: 'quota' | 'not-found' };

export interface Library {
  list(): LibraryRecord[];                        // newest-first by updatedAt
  open(id: string): LibraryEntry | null;
  create(stack: Stack, name: string): SaveResult; // name is collision-resolved
  save(id: string, stack: Stack): SaveResult;     // re-derives the record name when stack.name changed
  delete(id: string): void;
  lastOpened(): LastOpened | null;
  setLastOpened(target: LastOpened | null): void;
}

export interface LibraryDeps {
  storage: StorageLike;                           // Pick<Storage, 'getItem'|'setItem'|'removeItem'>
  now?: () => string;                             // default () => new Date().toISOString()
  newId?: () => string;                           // default a short URL-safe random id
}
export function createLibrary(deps: LibraryDeps): Library;
```

`StorageLike` keeps the `sharing` shape but adds `removeItem` (migration and delete need it). The library must be
able to *detect* a quota failure, so it is given a wrapper shaped like `main.ts`'s `keyStorage`: `getItem` and
`removeItem` swallow errors (privacy mode → treated as empty; a failed remove is harmless), but `setItem` **rethrows**.
`create`/`save` call `storage.setItem` inside a `try` and map a throw to `{ ok: false, reason: 'quota' }`. The old
`safeStorage` (which swallows `setItem` too) stays for the Summon/Settings key callers; it is **not** passed to the
library, or the library would never see a quota failure. Reads stay swallow-on-throw.

### 2.2 Storage layout (REQ-1.2)

- Index key `necrocard.library`:
  ```json
  { "version": 1, "entries": [ { "id": "...", "name": "...", "stackName": "...", "createdAt": "...", "updatedAt": "..." } ],
    "lastOpened": { "kind": "entry", "id": "..." } }
  ```
  `entries` is stored newest-first (sorted by `updatedAt` descending on every write), so `list()` is a read and a
  defensive re-sort, not a sort-on-read that could disagree with storage. Each record carries `stackName`, the
  body's `stack.name` as of the last save, so `save` can tell whether the name changed without reading the body
  (§2.5).
- Body key `necrocard.library.entry.<id>`: the canonical `serializeStack(stack)` string.
- `LIBRARY_VERSION = 1`. An index whose `version !== LIBRARY_VERSION`, or that does not parse, is treated as absent
  (REQ-5.4): `list()` returns `[]`, `lastOpened()` returns `null`. No migration of an unknown version in this spec.

Splitting metadata from bodies means one oversized or corrupt body key cannot make the index unreadable; `open`
of that entry returns `null` and `list()` drops it (below).

`setLastOpened` writes the index (the pointer lives in it), including on every sample open (§3.1). A failed
`setLastOpened` write is ignored: `lastOpened` is a pointer, not data, so a dropped write at most forgets which
stack to reopen, and it never surfaces a status message or blocks the open.

### 2.3 Reading and the drop-missing-body rule (REQ-1.2 crit 4, REQ-1.3 crit 4)

`readIndex()` parses the index key; on any failure returns a fresh empty index. `list()` returns
`index.entries` filtered to those whose body key is present and parseable — but filtering on every `list()` would
cost a parse per entry. Instead:

- `open(id)` parses the body and runs `validateStack`; a missing/corrupt body returns `null`.
- `list()` returns the index records as-is (cheap). The picker renders them; choosing one calls `open`, and a
  `null` there is handled by `main.ts` (status message, fall through to quiz). A body that is known-missing at write
  time never gets an index record (2.4), so the only way `list` shows a dead record is external tampering, which
  `open` catches. This keeps `list` O(n) on metadata only and still never *loads* a dead entry.

(The acceptance test for "list never includes a missing body" is satisfied by having `create` roll back the index
record when the body write fails — 2.5 — so the index and bodies stay in step.)

### 2.4 Name collision (REQ-1.4)

```
resolveName(requested, existingNames):
  if requested not in existingNames: return requested
  for n in 2,3,4,...:
    candidate = `${requested} ${n}`
    if candidate not in existingNames: return candidate
```

`existingNames` is the set of current index names (excluding the entry being re-derived on `save`). The
`(your copy)` suffix is **not** added here — the caller passes the already-"(your copy)" base name (from the fork,
REQ-2.2, or migration, REQ-5.3) as `requested`, and `resolveName` only adds the numeric tail. So a second fork
passes `"The Haunted Quiz (your copy)"`, collides, and becomes `"The Haunted Quiz (your copy) 2"`.

An entry's `name` is **derived from `stack.name`** (there is no separate library-only name; see §5). `create` sets
`name = resolveName(requestedBase)`, where `requestedBase` is `stack.name` normally, or `"<stack.name> (your copy)"`
for a fork or migration. `save` re-derives it only when the new body's `stack.name` differs from the previously
saved body's `stack.name` (below).

### 2.5 Create / save / delete (REQ-1.3, REQ-1.5)

- `create(stack, name)`:
  1. `id = newId()`, resolve the name, `ts = now()`.
  2. Write the body key first. If `setItem` throws → return `{ ok:false, reason:'quota' }`, **no index change**
     (no dangling record, REQ-1.5 crit 2).
  3. Append the record (`name` resolved, `stackName = stack.name`, `createdAt = updatedAt = ts`), re-sort
     newest-first, set `lastOpened = {kind:'entry', id}`, write the index. An index-write throw also returns
     `quota` after best-effort removing the body key just written.
  4. Return `{ ok:true, entry }`.
- `save(id, stack)`: if `id` not in the index → `{ ok:false, reason:'not-found' }` (no throw). Else write the body
  (throw → `quota`), bump `updatedAt`, and re-derive the name by comparing `stack.name` with the record's stored
  `stackName` (the name as of the last save): if they differ, set the record's `name = resolveName(stack.name)`
  against the other entries' names and set `stackName = stack.name`; otherwise keep both. Re-sort newest-first,
  write the index. (This is how an inspector rename flows to the picker label, §5.)
- `delete(id)`: `removeItem` the body key, drop the record, and if `lastOpened` pointed at this id set it to `null`,
  then write the index.

A single private `writeIndex(index)` centralises the `setItem` of the index and its quota mapping.

`create` sets `stackName = stack.name` on the new record (the fork and migration pass a `(your copy)` display name
but the same `stackName`), so the first `save` after an inspector rename compares against the real last-saved name.
No body read is needed on save.

### 2.6 `chooseInitialLoad` (REQ-5.1) and migration (REQ-5.3)

`chooseInitialLoad(location, deps)` builds a `Library` and decides the source:

```
migrateLegacy(library)              // once; see below
fragment #s= present        -> { source:'share', encoded }
?stack=<fixture> present    -> { source:'fixture', key }   // and library.setLastOpened({kind:'fixture',key})
last = library.lastOpened()
  last.kind==='entry' && open ok -> { source:'library', entry }
  last.kind==='fixture'          -> { source:'fixture', key: last.key }
otherwise                   -> { source:'default' }        // quiz
```

Return shape adds `corruptAutosave: boolean` (migration found a bad legacy value) and `corruptIndex: boolean`
(index unparseable/unknown-version), both driving the REQ-5.4 status message in `main.ts`.

`migrateLegacy` (REQ-5.3): if `necrocard.autosave` exists and is readable,
`create(stack, resolveForkName(stack.name))` where `resolveForkName` = `"<stack.name> (your copy)"`, then
`removeItem('necrocard.autosave')`, then `setLastOpened` to the new entry. If the legacy value is corrupt, remove
it and set `corruptAutosave`. Migration runs whenever the key exists (non-empty library included); it only *adds*
an entry. A `create` that fails on quota leaves the legacy key in place (so the data is not lost) and the app opens
the quiz — acceptable and rare; recorded as a known edge in testing.

The share decode stays in `main.ts` (`openShared` + `decodeStack`); `chooseInitialLoad` returns the fragment
un-decoded exactly as `sharing` did.

---

## 3. Session state and save routing in `main.ts` — REQ-2, REQ-3, REQ-6, REQ-7

### 3.1 `openTarget`

`main.ts` holds one new variable and builds the library with a throwing-`setItem` wrapper:

```ts
// getItem/removeItem swallow (like keyStorage); setItem rethrows so the library can detect quota.
const libraryStorage: StorageLike = {
  getItem: k => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => localStorage.setItem(k, v),          // rethrows
  removeItem: k => { try { localStorage.removeItem(k); } catch { /* nothing stored */ } },
};
const library = createLibrary({ storage: libraryStorage });

type OpenTarget = { kind: 'sample'; key: FixtureName } | { kind: 'entry'; id: string };
let openTarget: OpenTarget;
```

The existing `safeStorage` (which swallows `setItem`) stays for the Summon/Settings key callers and is not passed
to the library.

- Loading a fixture sets `{ kind:'sample', key }` and `library.setLastOpened({kind:'fixture', key})`.
- Loading / creating an entry (New Stack, Summon, Import, share, choosing a "My stacks" entry, a fork) sets
  `{ kind:'entry', id }` and `setLastOpened({kind:'entry', id})`.

The old `current: PickerValue` and `CUSTOM`/`UNTITLED` transient markers are gone; the picker's selected value is
now either a fixture key or a library id (§4).

### 3.2 The save signal (REQ-2.2, REQ-3)

The persist/fork/debounce logic lives in a new unit-testable module `src/ui/browse/persist.ts`, not inline in
`main.ts` (which is already near the 300-line guideline). `createPersist` takes the library, a current-stack
accessor, a status-line, and callbacks for "open target get/set", "drop the fixture link", and "picker rebuild";
it returns `{ persist(kind), flush() }`. `main.ts` wires the three signals to it. `persist.ts` imports `src/share/`
and `src/model/` only (`src/share/` itself stays model-only).

```ts
function persist(kind: 'authored' | 'browse-typing'): void {
  const s = currentStack(); if (!s) return;
  if (openTarget().kind === 'entry') {
    const r = saveDebounced(openTarget().id, s);          // 500 ms trailing wrapper around library.save
    if (r && !r.ok) status.show('Your library is full; that change was not saved.');
    return;
  }
  // A sample is open. Browse typing never forks (REQ-2.2 narrowing); only an authored edit does.
  if (kind === 'browse-typing') return;
  forkSampleToEntry(s);                                   // creates (your copy), flips openTarget, drops ?stack=
}
```

- `editor.onChange` → `persist('authored')`.
- message-box mutation → `persist('authored')`.
- `runtime.onFieldEdited` (unlocked Browse field) → `persist('browse-typing')`.

`forkSampleToEntry` calls `library.create(s, '<name> (your copy)')`; on success sets `openTarget` to the new entry,
calls `leaveFixtureLink()`, rebuilds the picker and selects the new entry; on quota failure shows the message and
leaves the sample open (the edit stays in the working copy, unsaved — acceptable, consistent with REQ-1.5).

`leaveFixtureLink()` is unchanged (REQ-7): it only strips `?stack=`. It now runs as part of a fork, since a fork is
exactly "this is no longer the sample".

### 3.3 Debounce and flush (REQ-3.1)

The debounce lives inside `persist.ts` (`saveDebounced`), keyed by the open entry id, keeping the 500 ms trailing
timer, the flush-before-immediate rule, and a `flush()` that `main.ts` calls from `pagehide` /
`visibilitychange`. A load flushes the pending save first (so a switch never loses the outgoing entry's last edit),
then the new stack is written immediately:
- entry load → `library.save(id, stack)` immediately after `runtime.load`;
- sample load → **no write** (REQ-3.1 crit 2); just flush the previous entry's pending save.

Because the debounce is now per-id, switching entries flushes the old id before the new id becomes current.

### 3.4 Script dispatches never save (REQ-3.2)

Unchanged from `sharing`: the only save calls are the three person-action signals above. Button-script dispatch has
no hook, so a quiz reload still starts fresh. The e2e keeps a "play, reload, fresh" assertion.

### 3.5 Initial-load switch (REQ-5)

The `chooseInitialLoad` switch gains a `library` case and keeps `share`, `fixture`, `default`:

```
case 'share':   openShared(encoded)                      // sets openTarget to the new entry on success (see below)
case 'fixture': loadKey(key)                             // openTarget = sample
case 'library': loadStack(entry.stack); openTarget = {entry}; picker.select(entry.id)
case 'default': loadKey(DEFAULT_FIXTURE)
if corruptAutosave || corruptIndex: status.show('Your saved stack could not be read; opening the sample stack.')
```

`openShared` (share URL) previously loaded with autosave off and showed a transient custom entry. Under the library
it instead `library.create(stack, stack.name)` so the shared stack becomes a kept entry (REQ-2.1 crit 4), sets
`openTarget` to it, and clears the fragment. This is the single-load-path decision from the review (§7.1): a
followed link *adds* an entry, nothing is transient. A visitor's existing entries are untouched (the shared stack
is just a new entry), so following a link still never overwrites their own work.

---

## 4. Stack picker (`src/ui/browse/stackPicker.ts`) — REQ-6.1

### 4.1 New shape

The picker keeps a single native `<select>` with two `<optgroup>`s:

```
<select id="stack-picker">
  <optgroup label="Samples">    <!-- three fixtures, fixed -->
  <optgroup label="My stacks">  <!-- library records, newest-first; omitted when empty -->
```

API change:

```ts
interface StackPicker {
  el: HTMLElement;
  select: HTMLSelectElement;
  /** Rebuild "My stacks" from records; keep "Samples" fixed. */
  setEntries(records: LibraryRecord[]): void;
  /** Select a fixture key or a library id. */
  select(value: FixtureName | string): void;
  setDisabled(disabled: boolean): void;
}
function createStackPicker(onChoose: (choice:
  { kind: 'fixture'; key: FixtureName } | { kind: 'entry'; id: string }) => void): StackPicker;
```

- Option values: fixture keys for samples; library ids for entries. `onChoose` tags which group was chosen by
  looking up whether the value is a fixture key.
- `customLabel`, `showCustom`, `showUntitled`, `UNTITLED`, `CUSTOM`, `PickerValue` are removed. Entry labels come
  straight from `record.name` (REQ-6.1 crit 3).
- Empty library → the "My stacks" `<optgroup>` is not rendered (REQ-6.1 crit 5).
- `fixtureFromSearch` / `urlWithFixture` stay (used by `?stack=`).

`main.ts` calls `picker.setEntries(library.list())` after every create or delete (and after a save that re-derived
the name, §2.5) and selects the open value.

---

## 5. Delete and inspector rename (`src/ui/browse/libraryControls.ts`) — REQ-4

Only one chrome button joins the toolbar, next to New Stack: **Delete**, built with `chromeButton`. It is enabled
only when `openTarget.kind === 'entry'` and `!runtime.isBusy`. On click it opens a `dialogShell` confirm with the
entry name and OK/Cancel (`retro-ui.md` chrome, focus-trapped, Escape → cancel). OK → `library.delete(id)`, then
`loadKey(DEFAULT_FIXTURE)` (quiz), rebuild the picker. Cancel/Escape → close, no change. `updateToolbar()` gains the
button's enable/disable (busy or a sample open → disabled).

**Rename has no dialog.** The Edit-mode inspector already renames a stack by setting `stack.name`, and
`editor.onChange` already calls `stage.setTitle(stack.name)` so the window title updates at once. A separate
library-only name would drift from that title, so there is no `library.rename` and no Rename button. Instead, an
entry's name follows `stack.name`: when the person renames the stack in the inspector, the next debounced
`library.save` (§2.5) sees the changed `stack.name` and re-derives the record's name with `resolveName`, so the
"My stacks" label and the window title agree. The entry keeps its `(your copy)`/numeric suffix as long as
`stack.name` is unchanged.

`libraryControls.ts` therefore exports just the Delete button and its confirm dialog.

---

## 6. Testing — REQ-8

### 6.1 `src/share/library.test.ts` (Vitest, fake StorageLike + injected clock & id)

- **Property (fast-check ≥ 100):** for any fixture-shaped stack and any name, `create` then `open` deep-equals the
  stack and the name is collision-resolved (REQ-1.6 crit 1).
- **Property:** a sequence of colliding `create`s yields all-distinct names and every body round-trips (REQ-1.6
  crit 2); `save` then `open` deep-equals; the index stays newest-first across create/save/delete (REQ-1.6 crit 3).
- Layout: one index key, one body key per id, a `version` field.
- `delete` removes body + record and clears `lastOpened` when it pointed there.
- Storage failure: a `setItem` that throws → `{ ok:false, reason:'quota' }` and no dangling index record.
- Migration: a legacy value imports once (named `(your copy)`), the legacy key is removed, re-load does not
  re-migrate, a corrupt legacy value is reported corrupt, migration adds to a non-empty library.
- A corrupt / unknown-version index reads as empty; an `open` of a missing body returns `null`.
- `save` re-derives the record name (and `stackName`) when `stack.name` differs from the record's `stackName`, and
  keeps both when it does not.

A deterministic `newId` (a counter) and `now` (a fixed clock stepped by the test) make ordering and ids stable.

### 6.2 `src/ui/browse/stackPicker.test.ts` (happy-dom)

Two groups render with titles "Samples" / "My stacks"; "My stacks" lists records newest-first by name; `onChoose`
reports `fixture` vs `entry` correctly; an empty library omits the group; `select(id)` selects the right option.

### 6.3 `test/e2e/stack-library.spec.ts` (Playwright)

1. New Stack → edit → switch to a sample → switch back to the Untitled entry → the edit is there.
2. Edit an entry → reload bare URL → the last-open entry reopens with edits.
3. Open an entry → Delete → confirm → the quiz opens, the entry is gone.
4. Open a sample → authored edit → a `(your copy)` entry appears; reopen the sample → pristine.
5. Seed `necrocard.autosave` + empty library → load → it appears as an entry, the legacy key is gone, it is open.
6. New Stack → rename it in the Edit-mode inspector → after the debounce, the "My stacks" label and the window
   title both show the new name (REQ-1.1 crit 3 / REQ-4.2).
Plus kept from `sharing`: play the quiz without editing, reload → fresh (no entry created).

### 6.4 Playwright MCP (REQ-8.3)

One dev-server run: New Stack → edit → switch to a sample → switch back, then open the picker. The picker is
screenshotted at the 2x card width (a 1441-wide viewport, as the retro-skin reference uses) so the `<optgroup>`
labels are legible, and the shot also confirms the toolbar still fits with the extra Delete button. Screenshots
`docs/screenshots/library-picker.png` and `docs/screenshots/library-delete-confirm.png`; read the console at the
end; finish by clearing `localStorage` so the run leaves no library behind.

### 6.5 `test/e2e/sharing.spec.ts` edits (§7.4)

Delete the assertions this spec supersedes: the `AUTOSAVE_KEY` import and the single-autosave cases (edit → reload →
same autosave), the single-autosave fork, and "a visitor's own save survives following a link". Keep the share
round-trip (open a link in a second page, same first card, fragment cleared) and the export/import cases. The
"play the quiz, reload, fresh" case now lives in `stack-library.spec.ts`.

### 6.6 Boundary test

The existing `src/share` boundary test already asserts `src/share/` imports only `src/model/`; it covers
`library.ts` with no change. The card-surface CSS guard stays green (chrome-only CSS).

---

## 7. Resolved review decisions

1. **Followed share link adds a library entry** (§3.5). Kept: one load path, nothing transient. Opening a share URL
   runs `library.create`, so the shared stack becomes a "My stacks" entry. A visitor's existing entries are
   untouched, so following a link never overwrites their own work.
2. **`list()` reads the index only** (§2.3). Accepted: `list()` returns index records without parsing bodies;
   `open()` catches a dead or corrupt body (returns `null`), and the write-side rollback (§2.5) keeps index and
   bodies in step, so a dead record only appears under external tampering.
3. **Migration under quota** (§2.6). Accepted: if the legacy import hits quota, the legacy key is kept (data not
   lost) and the quiz opens; migration retries on the next load.
4. **`autosave.ts` removal and `sharing` e2e** (§6.5). `chooseInitialLoad`, `AUTOSAVE_KEY`, `FRAGMENT_PARAM` and
   `DEFAULT_FIXTURE` move to `library.ts`. In `test/e2e/sharing.spec.ts`, the superseded assertions are deleted (the
   `AUTOSAVE_KEY` import, the single-autosave cases, the single-autosave fork, and "a visitor's own save survives a
   link"); the share round-trip and export/import cases stay. The "play, reload, fresh" case moves to
   `stack-library.spec.ts`.
5. **`<optgroup>` UA styling** (§4). Accepted: the UA look of `<optgroup>` labels is fine; only what `retro-ui.md`
   already covers is styled, and no card-surface rule is added. The MCP run screenshots the open picker at the 2x
   card width (1441 viewport) so the labels are visible, and confirms the toolbar still fits the extra Delete
   button.
```
