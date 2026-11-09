# stack-library — Tasks

Implementation plan for the stack library. Each task is a self-contained, test-backed step; later tasks build on
earlier ones. The standard six checks (`npm run typecheck`, `lint`, `test`, `build`, `server:build`, `e2e`) must be
green before a task is considered done, and the protected directories (`src/interp`, `src/model`, `fixtures`,
`src/summon`, `server/`) and `package.json` dependencies must stay unchanged throughout.

References in brackets point at the design (§) and requirements (REQ-) sections.

---

- [x] 1. Amend steering and the brief (REQ-10)
  - Done: `.kiro/steering/product.md` persistence section now describes the `localStorage` library; one line added under `docs/BRIEF.md` phase 2 item 0 naming spec `stack-library`; commit 510dcbd.
  - Edit `.kiro/steering/product.md` so the persistence section says the open stack and the person's other stacks
    are kept in a `localStorage` library (not a single autosave), in one or two short sentences. [REQ-10.1]
  - Add one short line under `docs/BRIEF.md` phase 2 item 0 noting that spec `stack-library` implements it.
  - Change no other steering rule; leave `structure.md`'s `src/share/` → `src/model/` boundary untouched.
  - _Requirements: REQ-10.1_

- [x] 2. Library model core: types, layout, create/open/list (REQ-1.1–1.4, design §2.1–2.5)
  - Done: `src/share/library.ts` exports the listed types, `LIBRARY_VERSION`, `createLibrary`, `resolveName`; it imports only `src/model/`; layout tests in `library.test.ts`; commit 510dcbd.
  - Create `src/share/library.ts` with `LibraryRecord`, `LibraryEntry`, `LastOpened`, `SaveResult`, `Library`,
    `LibraryDeps`, and `LIBRARY_VERSION = 1`. Import only `src/model/` (`Stack`, `serializeStack`, `validateStack`,
    `FixtureName`). [§2.1]
  - Implement `createLibrary({ storage, now?, newId? })` with the index/body layout (`necrocard.library`,
    `necrocard.library.entry.<id>`), a private `readIndex()` (empty on parse failure or unknown `version`) and
    `writeIndex()` (centralises the index `setItem` and quota mapping). [§2.2]
  - Implement `resolveName(requested, existingNames)` (numeric suffix only; caller supplies any `(your copy)`
    base). [§2.4, REQ-1.4]
  - Implement `list()` (index records, newest-first by `updatedAt`, re-sorted on read), `open(id)` (parse + validate
    body, `null` on missing/corrupt), and `create(stack, name)` (body first, then index; roll back the body on an
    index-write throw; `{ ok:false, reason:'quota' }` on any throw; set `lastOpened`). [§2.3, §2.5, REQ-1.2, REQ-1.3,
    REQ-1.5]
  - Default `now = () => new Date().toISOString()`, `newId` = a short URL-safe random id independent of `stack.id`.
  - _Requirements: REQ-1.1, REQ-1.2, REQ-1.3, REQ-1.4, REQ-1.5_

- [x] 3. Library model: save (name re-derivation), delete, last-open (REQ-1.1 crit 3, REQ-1.3, REQ-4.2, design §2.5)
  - Done: `save`, `delete`, `lastOpened` and `setLastOpened` in `library.ts`; covered by "save name re-derivation", "storage failure" and layout tests in `library.test.ts`; commit 510dcbd.
  - Implement `save(id, stack)`: `not-found` when the id is absent; else write the body (throw → `quota`), bump
    `updatedAt`, and re-derive the record name only when `stack.name` differs from the record's stored `stackName`
    (no body read), using `resolveName` against the other names, then set `stackName = stack.name`; same name →
    keep both. Re-sort; write the index. [§2.5, REQ-4.2]
  - Implement `delete(id)` (remove body + record; clear `lastOpened` if it pointed there) and
    `lastOpened()` / `setLastOpened(target)` (pointer lives in the index; a failed `setLastOpened` write is
    ignored). [§2.2, §2.5, REQ-1.3]
  - _Requirements: REQ-1.1, REQ-1.3, REQ-4.2_

- [x] 4. `chooseInitialLoad` and legacy migration (REQ-5, design §2.6)
  - Done: `chooseInitialLoad` with the share, fixture, library and default sources plus `corruptAutosave`/`corruptIndex`, and `migrateLegacy` (module-private, called from `chooseInitialLoad`) in `library.ts`; `AUTOSAVE_KEY` moved as `LEGACY_AUTOSAVE_KEY`, with `FRAGMENT_PARAM` and `DEFAULT_FIXTURE`; `chooseInitialLoad` and legacy migration blocks in `library.test.ts`; commit 510dcbd.
  - Add `chooseInitialLoad(location, deps)` to `library.ts` returning a tagged source (`share` | `fixture` |
    `library` | `default`) plus `corruptAutosave` and `corruptIndex` flags, with the priority: share fragment →
    `?stack=` fixture (and `setLastOpened` the fixture) → last-open (entry if `open` succeeds, else fixture) →
    quiz. [§2.6, REQ-5.1]
  - Add `migrateLegacy(library, storage)`: when `necrocard.autosave` exists and is readable, `create(stack,
    "<stack.name> (your copy)")`, remove the legacy key, set it last-open; a corrupt value → remove and flag
    `corruptAutosave`; a quota failure on import → keep the legacy key and fall through. Runs whenever the key
    exists. [§2.6, REQ-5.3]
  - Move `AUTOSAVE_KEY`, `FRAGMENT_PARAM`, `DEFAULT_FIXTURE` here from `autosave.ts`. [§7.4]
  - _Requirements: REQ-5.1, REQ-5.3, REQ-5.4_

- [x] 5. Library unit and property tests (REQ-8.1, design §6.1)
  - Done: `src/share/library.test.ts` has three fast-check properties at 100 runs each plus the layout, delete, quota, re-derivation, migration, corrupt-index and missing-body examples; included in the 1089-test `npm test` run; commit 510dcbd.
  - Create `src/share/library.test.ts` with a fake `StorageLike` (throwing-`setItem` variant for the quota case),
    an injected counter `newId` and a stepped `now`.
  - fast-check ≥ 100: `create`→`open` deep-equals and name is collision-resolved; a sequence of colliding `create`s
    yields all-distinct names with every body round-tripping; `save`→`open` deep-equals; the index stays
    newest-first across create/save/delete. [REQ-1.6]
  - Examples: layout keys and `version`; `delete` clears last-open; a `setItem` throw → `quota` with no dangling
    record; `save` re-derives the name when `stack.name` differs from the stored `stackName` and keeps it
    otherwise; migration imports once, removes the legacy key, reports a corrupt legacy value, and adds to a
    non-empty library; a corrupt/unknown index reads empty; `open` of a missing body is `null`. [REQ-8.1]
  - _Requirements: REQ-1.6, REQ-8.1_

- [x] 6. Stack picker: two groups and the new API (REQ-6.1, design §4)
  - Done: `stackPicker.ts` has the "Samples" and "My stacks" optgroups, `setEntries`, `setDisabled` and `createStackPicker(onChoose)`; the old `customLabel`/`showCustom`/`UNTITLED`/`PickerValue` names are gone; the select-by-value method is named `setSelected` rather than `select`; `stackPicker.test.ts` covers the listed cases; commit 510dcbd.
  - Rework `src/ui/browse/stackPicker.ts`: a single `<select>` with a "Samples" `<optgroup>` (the three fixtures,
    unchanged) and a "My stacks" `<optgroup>` rebuilt from records (omitted when empty). [§4, REQ-6.1]
  - New API: `setEntries(records)`, `select(value)`, `setDisabled(disabled)`, and
    `createStackPicker(onChoose)` where `onChoose` reports `{ kind:'fixture', key } | { kind:'entry', id }`.
  - Delete `customLabel`, `showCustom`, `showUntitled`, `UNTITLED`, `CUSTOM`, `PickerValue`; keep `fixtureFromSearch`
    and `urlWithFixture`. Entry labels are `record.name` verbatim. [REQ-6.1]
  - Update `src/ui/browse/stackPicker.test.ts`: two groups with the right titles; "My stacks" newest-first by name;
    `onChoose` reports fixture vs entry; empty library omits the group; `select(id)` selects the right option.
    Remove the obsolete `customLabel`/transient-entry tests. [REQ-8.1]
  - _Requirements: REQ-6.1, REQ-8.1_

- [x] 7. Delete button and confirm dialog (REQ-4.1, design §5)
  - Done: `src/ui/browse/libraryControls.ts` (Delete button and confirm on `createDialogShell`, named stack, Cancel/Escape) with `libraryControls.test.ts`; button placed in the `main.ts` toolbar and enabled only for an open entry when not busy; commit 510dcbd.
  - Create `src/ui/browse/libraryControls.ts` exporting the Delete `chromeButton` and a confirm built on
    `createDialogShell` (named stack, OK/Cancel, Escape → cancel). It takes callbacks for "is an entry open",
    "delete + reopen quiz", and the open entry's name. [§5, REQ-4.1]
  - Add the Delete button to the toolbar next to New Stack; add its enable/disable to `updateToolbar()` (enabled
    only when a library entry is open and not busy).
  - Add chrome CSS in `src/ui/chrome.css` only if the button needs it; add no `.card-surface` rule.
  - _Requirements: REQ-4.1_

- [x] 8. Persist module (`src/ui/browse/persist.ts`) + its unit test (REQ-2.2, REQ-3, design §3.2–3.3)
  - Done: `persist.ts` (`createPersist` with `persist(kind)` and `flush()`, 500 ms trailing debounce, fork on a sample's authored edit) and `persist.test.ts` covering the listed cases; commit 510dcbd.
  - Create `src/ui/browse/persist.ts` exporting `createPersist(deps)` returning `{ persist(kind), flush() }`.
    Deps: the `Library`, a current-stack accessor, a `StatusLine`, open-target get/set callbacks, a drop-fixture-link
    callback, and a picker-rebuild callback. Imports `src/share/` and `src/model/` only.
  - `persist('authored'|'browse-typing')`: for an entry, a 500 ms trailing debounced `library.save` (quota → the
    REQ-3.3 status message); for a sample, fork a `(your copy)` entry on an authored edit, and ignore
    `browse-typing` (REQ-2.2 narrowing). `flush()` writes a pending debounced save now. A load calls `flush()`
    first, then writes immediately for an entry / nothing for a sample. [§3.2, §3.3, REQ-2.2, REQ-3.1]
  - Create `src/ui/browse/persist.test.ts` (happy-dom, fake timers, fake library): debounce coalesces; flush writes
    now; an entry save routes to `library.save`; a sample authored edit forks once and flips the target; a sample
    browse-typing does nothing; a quota failure shows the message. [REQ-8.1]
  - _Requirements: REQ-2.2, REQ-3.1, REQ-3.2, REQ-3.3_

- [x] 9. Wire the library into `main.ts` (REQ-2, REQ-5, REQ-6.2, REQ-7, design §3)
  - Done: `main.ts` builds the library on `libraryStorage`, holds `openTarget`, routes the three save signals and `pagehide`/`visibilitychange` through `persist`, loads via `chooseInitialLoad`, keeps `leaveFixtureLink`; `src/share/autosave.ts` and its test are deleted; commit 510dcbd.
  - Build the library with a throwing-`setItem` `libraryStorage` wrapper; keep `safeStorage` for the Summon/Settings
    key callers. [§3.1, Amendment 2]
  - Remove `createAutosave`/`autosave.*`; hold an `openTarget` (`sample` | `entry`) and build the persist module
    (task 8), routing the three signals: `editor.onChange` → `persist('authored')`; message-box mutation →
    `persist('authored')`; `runtime.onFieldEdited` → `persist('browse-typing')`; `pagehide` /
    `visibilitychange` → `persist.flush()`. [§3.2, REQ-6.2]
  - Replace the initial-load switch with the `chooseInitialLoad` result (`library` case loads the entry and sets
    `openTarget`; `fixture`/`default` set a sample; `corruptAutosave || corruptIndex` → the REQ-5.4 status message).
    Make `openShared` create a library entry (single load path). New Stack, Summon, Import, choosing an entry, and a
    fork all set `openTarget` and `setLastOpened`. Rebuild the picker from `library.list()` after create/delete and
    after a save that re-derived the name. [§3.5, REQ-5, REQ-2.1, REQ-6.2]
  - Keep `leaveFixtureLink` (strip `?stack=`), now called as part of a fork (REQ-7).
  - Delete `src/share/autosave.ts` once nothing imports it; update any import of `AUTOSAVE_KEY`/`DEFAULT_FIXTURE`.
  - _Requirements: REQ-2.1, REQ-2.3, REQ-5.1, REQ-5.2, REQ-6.2, REQ-6.3, REQ-7.1, REQ-7.2_

- [x] 10. Trim the superseded `sharing` e2e (REQ-8.2 crit 8, design §6.5)
  - Done: `test/e2e/sharing.spec.ts` has no `AUTOSAVE_KEY` import (imports :4-5) and keeps the share round-trip (:19) and export/import (:57); the removed single-autosave cases are covered by `stack-library.spec.ts:69` (edit and reload), `:101` (fork) and `:157` (play, reload, fresh); commit 510dcbd. Note: the removed "typing into an unlocked field in Browse is saved" case has no e2e replacement — Browse field typing is covered only by `persist.test.ts:70` and `:109`.
  - In `test/e2e/sharing.spec.ts` delete the `AUTOSAVE_KEY` import and the superseded cases: the single-autosave
    edit-survives-reload cases, the single-autosave fork, and "a visitor's own save survives following a link".
  - Keep the share round-trip (open a link in a second page, same first card, fragment cleared) and the
    export/import cases.
  - _Requirements: REQ-8.2_

- [x] 11. Library end-to-end tests (REQ-8.2, design §6.3)
  - Done: `test/e2e/stack-library.spec.ts` has the seven listed cases; it passed in a full `npm run e2e` run (30 passed); commit 510dcbd, with the two fixed waits later replaced by retrying checks in commit 446e923.
  - Create `test/e2e/stack-library.spec.ts`:
    1. New Stack → edit → switch to a sample → switch back → the edit is there.
    2. Edit an entry → reload bare URL → the last-open entry reopens with edits. [REQ-5.2]
    3. Open an entry → Delete → confirm → the quiz opens, the entry is gone. [REQ-4.1]
    4. Open a sample → authored edit → a `(your copy)` entry appears; reopen the sample → pristine. [REQ-2.2]
    5. Seed `necrocard.autosave` + empty library → load → it appears as an entry, the legacy key is gone, it is
       open. [REQ-5.3]
    6. New Stack → rename in the inspector → after the debounce the "My stacks" label and the window title both show
       the new name. [REQ-4.2]
    7. Play the quiz without an authored edit → reload → fresh, no entry created. [REQ-3.2]
  - _Requirements: REQ-8.2_

- [x] 12. Full verification and the Playwright MCP run (REQ-8.3, design §6.4)
  - Done: on 2026-11-07 `npm run check`, `npm test` (75 files, 1097 tests), `npm run build`, `npm run server:build` and `npm run e2e` (30 passed, including `stack-library.spec.ts`) all passed, with the `src/share` boundary test and card-surface guard inside `npm test`; commit 510dcbd touched none of `src/interp`, `src/model`, `fixtures`, `src/summon`, `server/` or `package.json`; the MCP run, `docs/screenshots/library-picker.png`, `docs/screenshots/library-delete-confirm.png` and the `localStorage` clear are logged in `KIRO_USAGE.md` entry "2026-11-04 - Spec 9: stack-library". Exception, accepted without splitting: the "no file over ~300 lines" check is not met — `main.ts` 378 and `library.ts` 318 (the usage log flagged both on 2026-11-04).
  - Run the six checks; confirm the protected directories and `package.json` deps are unchanged, the `src/share`
    boundary test and the card-surface guard are green, and no file is over ~300 lines (split if needed).
  - One MCP run against the dev server (already running on http://localhost:5173): New Stack → edit → switch to a
    sample → switch back, open the picker at the 2x card width (1441-wide viewport) to show both groups and confirm
    the toolbar still fits the Delete button; screenshot `docs/screenshots/library-picker.png` and
    `docs/screenshots/library-delete-confirm.png`; read the console; finish by clearing `localStorage`.
  - Write the run entry in `KIRO_USAGE.md`.
  - _Requirements: REQ-8.3, REQ-9_
```
