# stack-library — Requirements

## Overview

The stack library gives the person a named list of their own stacks in the stack picker, kept in `localStorage`,
so the demo can summon, import or start several stacks and switch between them without losing any. Today the app
keeps exactly one autosaved stack under `necrocard.autosave`: summoning, importing, or starting a second stack
silently replaces the first. The library keeps every stack the person has touched and makes switching lossless.
There is no server.

This spec follows HyperCard's rule that a stack is always saved: there is no Save command and no Save button. A
stack that is open is a library entry, and edits to it persist on their own. The one new verb is Delete.

This is spec 9 (the brief lists specs 9, 10 and 11) and the first phase-2 item (`docs/BRIEF.md` phase 2, item 0).
It builds on `sharing`
(`src/share/autosave.ts`, `chooseInitialLoad`, the debounce and page-hide flush, `leaveFixtureLink`), `browse-mode`
(the stack picker, the runtime, the status line), `edit-mode` / `summon` (New Stack, Summon, Import, the custom
picker entry) and the shared chrome dialog shell.

**This spec supersedes `sharing` REQ-2 (autosave) in full.** Where `sharing` kept a single value under
`necrocard.autosave`, the library keeps many named entries; where `sharing` REQ-2.2 defined the load-priority order,
REQ-5 below redefines it; where `sharing` REQ-2.4 said "there is one autosave; there is no history of past stacks",
that no longer holds. The parts of `sharing` this spec keeps unchanged are called out where they apply: the
500 ms trailing debounce and page-hide flush (REQ-3), the rule that script dispatches never save (REQ-3), the
corrupt-value status message (REQ-5.4), the `?stack=` link and `leaveFixtureLink` fork-on-first-edit behaviour
(REQ-7), and the share-fragment and codec paths from `sharing` REQ-1 and REQ-4, which are untouched. `src/share/`
still imports only `src/model/`.

Sources: `docs/BRIEF.md` phase 2 item 0 and the spec list entry 9; steering `product.md` (autosave, persistence),
`structure.md` (`src/share/` imports `src/model/` only; module boundaries), `tech.md` (lossless serialization,
testing tools, pinned deps), `retro-ui.md` (the picker groups and the Delete confirm are chrome, not card surface).

### In scope

A pure `src/share/library.ts` module (StorageLike injected) that stores an index plus one key per entry, with a
version field and entry ids independent of the stack's own id; create / open / save / delete / list operations and a
name-collision suffix rule (an entry's name follows `stack.name`); a one-time migration of the legacy
`necrocard.autosave` value; a redefined page-load priority that reopens the last-open stack (sample or entry);
stack-picker changes to show "Samples" and "My stacks" groups with the summoned and Untitled entries no longer
transient; a Delete button in the chrome with a confirm in the existing dialog shell (rename is via the inspector,
no dialog); `main.ts` wiring; a Task-1 amendment of steering `product.md` and a one-line note in `docs/BRIEF.md`;
Vitest unit, property and DOM tests; Playwright e2e; one Playwright MCP run.

### Out of scope

Any server or cloud sync; a Save command or Save button (a stack is always saved); import/export changes (`sharing`
REQ-3 is untouched); the share codec and dialog (`sharing` REQ-1, REQ-4 untouched); duplicate / export-all /
reorder of library entries; folders, tags or search; any change to `src/interp/`, `src/model/`, `fixtures`,
`src/summon/` or `server/`; new dependencies; a multi-tab live-sync of the library across windows.

---

## REQ-1 — Library model (`src/share/library.ts`, pure)

### REQ-1.1 — Entry shape

A library entry is `{ id, name, stack, createdAt, updatedAt }`, where `id` is a library entry id generated
independently of `stack.id` (two summoned copies of the quiz share a `stack.id`, so the entry id must not be it),
`name` is a user-facing string shown in the picker, `stack` is a valid `Stack`, and the timestamps are ISO
date-time strings.

Acceptance criteria:
1. `id` is a short URL-safe string unique within the library, never equal to or derived from `stack.id`.
2. Creating two entries from the same stack value yields two entries with different `id`s.
3. `name` is derived from `stack.name`: renaming the stack in the Edit-mode inspector renames its library entry on
   the next save (REQ-4.2), so the picker label and the window title agree. There is no separate library-only name.

### REQ-1.2 — Storage layout

The library uses one index key and one key per entry, so one oversized stack cannot make the whole library
unreadable.

Acceptance criteria:
1. An index key (`necrocard.library`) holds a JSON object with a `version` number and an ordered
   list of `{ id, name, createdAt, updatedAt }` records — metadata only, no stack bodies.
2. Each entry's stack body is stored under its own key (`necrocard.library.entry.<id>`), as the
   canonical JSON from `serializeStack`.
3. The index carries a `version` integer; an index whose `version` is unknown is treated as absent (REQ-5.4), not
   crashed on.
4. A read that finds an index record but a missing or unreadable body key drops that entry from the returned list
   rather than throwing.

### REQ-1.3 — Operations

`createLibrary({ storage, now?, newId? })` returns an object exposing pure, synchronous operations over the injected
storage. `storage` is a `StorageLike` whose `getItem`/`removeItem` swallow errors but whose `setItem` **rethrows**,
so the library can detect a quota failure (REQ-1.5); the clock and id factory are injectable for deterministic
tests. The minimum surface:
- `list(): LibraryRecord[]` — index records, newest first (by `updatedAt`).
- `open(id): LibraryEntry | null` — the full entry, or null if absent/unreadable.
- `create(stack, name): LibraryEntry` — write a new entry and index record, return it.
- `save(id, stack): SaveResult` — overwrite the body, bump `updatedAt`, re-derive the record name when
  `stack.name` changed (REQ-4.2), re-order the index.
- `delete(id): void` — remove the body key and the index record.
- `lastOpened(): LastOpened | null` / `setLastOpened(target): void` — the stack to reopen on load, a tagged
  `{ kind: 'fixture', key } | { kind: 'entry', id }` so a sample reopens pristine and an entry reopens with its
  edits (REQ-5.1).

Acceptance criteria:
1. Every operation uses only the injected `StorageLike`; no `window`, `Date.now` or `crypto` reached except through
   injectable helpers (a clock and an id factory are injectable for deterministic tests).
2. `save` to an id not in the index is a no-op that returns a result flagged as "not found", not a thrown error.
3. `delete` of the currently last-opened entry clears `lastOpened` (so REQ-5 falls through to the quiz).
4. `list` never includes an entry whose body key is missing (REQ-1.2 criterion 4).

### REQ-1.4 — Name-collision suffix

When a new entry's requested name already exists in the library, a numeric suffix makes it unique: `<name> 2`,
`<name> 3`, and so on. This is the same rule the first-edit fork uses for `<name> (your copy)` (REQ-2), so forking a
sample twice yields `<name> (your copy)` then `<name> (your copy) 2`.

Acceptance criteria:
1. A requested name not already present is used unchanged.
2. The first collision appends ` 2`; the next ` 3`; the suffix is chosen so the result is not itself a collision.
3. The suffix counts the base name and existing suffixed names together, so no two entries ever share a name.
4. When a `save` re-derives the name because `stack.name` changed (REQ-4.2), the same rule resolves it against the
   other entries' names.

### REQ-1.5 — Storage-failure handling

A quota or storage failure on any write surfaces to the caller as a failed `SaveResult`, never a silent drop and
never a thrown error that reaches the UI.

Acceptance criteria:
1. `create` and `save` return a result carrying an `ok: false` and a reason when `setItem` throws (quota/full/
   unavailable), leaving the in-memory open stack untouched.
2. A failed body write does not leave a dangling index record (the index is written only after the body succeeds,
   or is rolled back).
3. The caller (REQ-6) turns a failed result into a status-line message; the open stack stays editable.

### REQ-1.6 — Round-trip and uniqueness property tests (fast-check, ≥ 100 runs)

Acceptance criteria:
1. For any fixture-shaped valid stack and any name, `create` then `open` returns an entry whose `stack` deep-equals
   the input and whose `name` is the collision-resolved name.
2. For any sequence of `create` calls with colliding names, every resulting entry has a distinct `name`, and every
   entry's body round-trips through `open`.
3. `save` then `open` deep-equals the saved stack; the index stays ordered newest-first across a mix of
   `create`/`save`/`delete`.

---

## REQ-2 — Every non-sample stack lives in the library

A stack that is not an unchanged bundled sample is always a library entry. HyperCard has no Save command; being open
means being saved.

### REQ-2.1 — Entry creation points

Acceptance criteria:
1. New Stack creates an entry named `Untitled` (collision-resolved per REQ-1.4) and opens it.
2. Summon creates an entry named after the summoned stack (`stack.name`), opens it, and selects it in the picker.
3. Import creates an entry named after the imported stack and opens it.
4. Opening a share URL creates an entry named after the shared stack (see REQ-5.1 for ordering against the other
   sources) and opens it.
5. The three bundled fixtures, opened and left unedited, do **not** create an entry.

### REQ-2.2 — Forking a sample on first edit

The first **authored** edit of a bundled sample forks a library copy named `<name> (your copy)` (the existing label
from the picker fix), with REQ-1.4 suffixes on collision. This replaces the single autosave fork of `sharing`.

An authored edit here means an Edit-mode committed mutation or a message-box mutation. It deliberately does **not**
include typing into an unlocked field in Browse. This is a narrowing of `sharing` REQ-2.1's save signals for the
sample case: playing a sample (for example typing an answer into a quiz field) must not create a `(your copy)`
entry. Browse-field typing still persists when a library **entry** is already open (REQ-3.2 keeps it as a save
signal there); it just does not, on its own, fork a sample.

Acceptance criteria:
1. Opening a sample and playing it — including typing into an unlocked Browse field — creates no entry; a reload
   still starts the sample fresh (its last-open is the fixture, REQ-5.1).
2. The first authored edit (an Edit-mode mutation or a message-box mutation) creates one entry named
   `<name> (your copy)` and makes it the open entry, so the edit and all later edits persist to the copy.
3. The bundled sample on disk and in the fixtures is never written to; reopening the sample shows it pristine.
4. A second fork of the same sample is named `<name> (your copy) 2`.

### REQ-2.3 — The Untitled and summoned entries are no longer transient

`sharing` / `summon` treated the Untitled and summoned picker entries as transient (choosing another entry removed
them). They are now real library entries.

Acceptance criteria:
1. After New Stack, choosing a sample and then choosing the Untitled entry again reopens the same stack with its
   edits, not a fresh Untitled.
2. After Summon, choosing a sample and then choosing the summoned entry reopens the summoned stack with its edits.
3. Switching between any two entries never loses edits to either (each is saved before the switch, per REQ-3).

---

## REQ-3 — Persisting edits to the open entry

While a library entry is open, the person's edits persist to that entry's body, keeping the autosave timing and
rules `sharing` defined.

### REQ-3.1 — Debounce and flush (unchanged from `sharing` REQ-2.1)

Acceptance criteria:
1. Edit-mode committed mutations save after a 500 ms trailing debounce; rapid edits coalesce into one write.
2. A stack load (New Stack, Summon, Import, share, choosing an entry) flushes any pending debounced save, then
   writes immediately. A load of a bundled **sample** flushes the previously open entry's pending save and then
   writes nothing new, since an unedited sample has no entry (REQ-2.1 criterion 5); the first authored edit forks
   one (REQ-2.2).
3. A page-hide (`pagehide`/`visibilitychange`) flushes a pending debounced save.
4. The write target is the open entry's body key (REQ-1.2), via `library.save(openId, stack)`.

### REQ-3.2 — Script dispatches never save (unchanged from `sharing` REQ-2.1)

Acceptance criteria:
1. A button-script dispatch does not trigger a save, so reloading a stack mid-play resumes from the last authored
   state, not the script's running state (a quiz reload starts fresh).
2. The save signals are exactly the person-action signals from `sharing` REQ-2.1: Edit-mode mutations, message-box
   mutations, and typing into an unlocked Browse field.

### REQ-3.3 — A save failure is surfaced, not swallowed

Acceptance criteria:
1. A failed `library.save` (REQ-1.5) shows the one-line status message `Your library is full; that change was not
   saved.` and leaves the open stack editable; the person can retry by editing again.
2. The failure does not corrupt the index or the entry's previous saved body.

---

## REQ-4 — Delete (chrome) and rename

### REQ-4.1 — Delete

A Delete button in the chrome removes the open library entry after a confirm.

Acceptance criteria:
1. The button lives in the chrome (`retro-ui.md` styling, not the card surface) and is enabled only when a library
   entry is open; it is disabled while a bundled sample is open and while the runtime is busy.
2. Activating it opens a confirm in the existing chrome dialog shell (the `summon`/`sharing` dialog shell: modal,
   labelled, focus-trapped, Escape cancels) asking to delete the named stack.
3. Confirming calls `library.delete(openId)`, then opens the quiz (the default fixture) in Browse, and the deleted
   entry is gone from the picker.
4. Cancelling leaves the entry open and unchanged.

### REQ-4.2 — Rename via the inspector (no dialog)

Rename reuses the Edit-mode inspector's existing stack-name field; there is no separate Rename button or dialog. A
library-only name would drift from the window title (which already tracks `stack.name` via `stage.setTitle`), so an
entry's name follows `stack.name`.

Acceptance criteria:
1. Renaming the open stack in the inspector (editing `stack.name`) triggers the normal debounced save; on that
   save, when `stack.name` differs from the previously saved body's `stack.name`, the entry's record name becomes
   `resolveName(stack.name)` against the other entries' names (REQ-1.4).
2. After the save, the "My stacks" picker label and the window title both show the new name.
3. A save whose `stack.name` is unchanged keeps the entry's current name, including any `(your copy)` or numeric
   suffix.
4. A bundled sample has no entry, so renaming it in the inspector forks a `(your copy)` entry (REQ-2.2) named from
   the edited `stack.name` like any other authored edit; the sample on disk is untouched.

---

## REQ-5 — Page-load order and migration

### REQ-5.1 — Load priority (redefines `sharing` REQ-2.2)

`chooseInitialLoad(location, storage, library)` decides the page-load source in this order:
1. a share fragment (`#s=…`) in the URL;
2. a `?stack=<fixture>` query (an explicit fixture link);
3. the last-open stack — a sample or an entry (`library.lastOpened()`);
4. the default quiz fixture.

Last-open tracks samples as well as entries, so choosing "The Cursed Manor" from the picker and reloading reopens
that sample (pristine), not some unrelated entry. It is a tagged target: `{ kind: 'fixture', key }` for a sample,
`{ kind: 'entry', id }` for an entry.

Acceptance criteria:
1. The return value is a tagged source (`share`, `fixture`, `library`, or `default`) plus the payload to load it, so
   `main.ts` stays declarative.
2. A share fragment wins over everything, as in `sharing`; a `?stack=` fixture link still beats the last-open stack
   and sets last-open to that sample.
3. With no fragment and no `?stack=`, the last-open stack loads: a sample reopens pristine, an entry reopens with
   its edits. If there is no last-open (or the entry was deleted, REQ-1.3 criterion 3), the quiz loads.
4. Choosing a sample in the picker sets last-open to `{ kind: 'fixture', key }`; choosing an entry, or any
   entry-creation point (REQ-2.1), sets it to `{ kind: 'entry', id }`. Delete clears last-open.

### REQ-5.2 — Reopen the last stack on reload

Acceptance criteria:
1. After editing an entry and reloading with a bare URL (no `#`, no `?stack=`), the same entry reopens with its
   edits.
2. After choosing a sample from the picker and reloading with a bare URL, that sample reopens pristine (its
   last-open is the fixture, not an entry).
3. After switching stacks and reloading, the stack open at the time of the last person action reopens.

### REQ-5.3 — Migration of the legacy autosave

On first load with a legacy `necrocard.autosave` value present, that value is migrated into the library once and the
legacy key removed, whether or not the library already has entries.

Acceptance criteria:
1. When a readable `necrocard.autosave` value exists, it is imported as one entry named by the fork rule
   (`<name> (your copy)` with REQ-1.4 suffixes, so a migrated autosaved copy of a sample lands as
   `The Haunted Quiz (your copy)`), the legacy key is removed, and that entry becomes last-open so it reopens
   immediately. (This answers open questions 4 and 5.)
2. Migration runs once: after it, the legacy key is gone and a later load does not re-migrate.
3. Migration happens even when the library already has entries; it adds one entry (collision-resolved) and never
   overwrites an existing entry or a sample.

### REQ-5.4 — Corrupt values (keeps `sharing` REQ-2.3's message)

Acceptance criteria:
1. A corrupt legacy `necrocard.autosave` value (not JSON, or failing `validateStack`) is ignored, the app falls
   through to the next source, and the status line shows the `sharing` REQ-2.3 message (`Your saved stack could not
   be read; opening the sample stack.`).
2. A corrupt library index (unparseable, or an unknown `version`) is treated as empty — the app opens the quiz and
   shows the same status message — rather than throwing; individual unreadable entries are dropped per REQ-1.2.
3. Reading `localStorage` when unavailable (privacy mode) falls through silently to the quiz with no message, as in
   `sharing`.

---

## REQ-6 — Picker and integration (`src/ui/browse/stackPicker.ts`, `src/main.ts`)

### REQ-6.1 — Two picker groups

The picker shows two groups: "Samples" (the three bundled fixtures, unchanged order and labels) and "My stacks"
(library entries, newest first). The custom-label logic now in `stackPicker.ts` (`customLabel`, which appends
`(your copy)` for a name clashing with a sample) moves into the library naming rule (REQ-1.4 / REQ-2.2): the library
already stores the resolved name, so the picker shows library `name`s verbatim with no per-label computation.

Acceptance criteria:
1. The picker uses two labelled groups (`<optgroup>`) titled "Samples" and "My stacks".
2. "Samples" lists the three fixtures exactly as today (`sharing`/`browse-mode` labels and order).
3. "My stacks" lists library entries newest-first (by `updatedAt`), each labelled by its library `name` verbatim
   (REQ-1.4 names, including `(your copy)` and numeric suffixes); the picker does not recompute labels.
4. Choosing a sample opens the fixture; choosing a library entry calls `library.open` and loads that stack.
5. When the library is empty, the "My stacks" group is omitted entirely; the picker is still usable.
6. The groups and the Delete confirm follow `retro-ui.md` chrome styling and never touch the card surface.

### REQ-6.2 — One load path and the change signal

Acceptance criteria:
1. Every load (fixture, entry, New Stack, Summon, Import, share) goes through the existing `loadStack`; a load of a
   library entry turns autosave on against that entry's id, a load of a bundled sample leaves autosave targeting
   nothing until the first edit forks a copy (REQ-2.2).
2. The person-action change signals wired in `sharing` REQ-5.1 route per the open stack: for a library entry, an
   Edit-mode mutation, a message-box mutation, or an unlocked Browse-field edit calls `library.save(openId, …)`;
   for a bundled sample, only an Edit-mode or message-box mutation triggers the fork (REQ-2.2), and Browse-field
   typing on a sample is ignored (the narrowing in REQ-2.2).
3. `main.ts` stays declarative over `chooseInitialLoad`; the picker is rebuilt from `library.list()` after every
   entry-creation and delete, and after a save that re-derived the entry name from a changed `stack.name`.

### REQ-6.3 — Boundaries

Acceptance criteria:
1. `src/share/library.ts` imports only `src/model/` (the `src/share/` boundary test covers it).
2. `src/ui/browse/` and `src/main.ts` may import `src/share/` and `src/model/`; no new import of `src/summon/`
   internals, `src/interp/` or `server/`.
3. Only chrome CSS changes; no new rule is scoped to `.card-surface` (the card-surface guard test stays green).

---

## REQ-7 — `?stack=` links and leaveFixtureLink (kept from `sharing`)

### REQ-7.1 — A `?stack=` link opens the sample itself

Acceptance criteria:
1. `?stack=<fixture>` opens the bundled sample, not a library copy, as today.
2. Playing it without an authored edit keeps the `?stack=` query, so a reload starts the sample fresh (it does not
   reopen a library entry).

### REQ-7.2 — First edit forks and drops the query

Acceptance criteria:
1. The first authored edit of a sample reached via `?stack=` forks a `<name> (your copy)` library entry (REQ-2.2)
   and drops the `stack` query from the URL (`leaveFixtureLink`), exactly as `sharing` did, now pointing autosave
   at the forked entry.
2. After the fork, a reload reopens the forked entry (REQ-5), not the sample.

---

## REQ-8 — Testing

### REQ-8.1 — Unit and property (Vitest)

Acceptance criteria:
1. `library.test.ts` (happy-dom or node with a fake `StorageLike`, injected clock and id factory):
   - the REQ-1.6 round-trip property (`create`/`save` → `open` deep-equals) at ≥ 100 runs;
   - the REQ-1.4 name-collision property: any sequence of colliding `create`s yields all-distinct names and every
     body round-trips;
   - index layout (one index key, one body key per entry, version field); newest-first ordering;
   - `delete` removes body and record and clears last-open when it was that entry;
   - a storage-failure (`setItem` throws) returns a failed result with no dangling index record (REQ-1.5);
   - migration: a legacy value imports once, the legacy key is removed, and a corrupt legacy value is reported
     corrupt;
   - a corrupt/unknown-version index reads as empty; an unreadable body drops only that entry.
2. `stackPicker.test.ts` additions (happy-dom): two groups render with the right titles; "My stacks" lists entries
   newest-first by library name; choosing a sample vs an entry fires the right callback; an empty library is
   handled (REQ-6.1 criterion 5).

### REQ-8.2 — End-to-end (Playwright, `test/e2e/stack-library.spec.ts`)

Acceptance criteria:
1. New Stack, make an edit, switch to a sample, switch back to the Untitled entry: the edit is still there.
2. Edit an entry, reload with a bare URL: the last-open entry reopens with its edits (REQ-5.2).
3. Open a library entry, Delete it, confirm: the quiz opens and the entry is gone from the picker (REQ-4.1).
4. Open a sample, make an authored edit: a `<name> (your copy)` entry appears in "My stacks", and reopening the
   sample shows it pristine (REQ-2.2).
5. Legacy migration: seed `necrocard.autosave` with a valid stack and an empty library, load: the stack appears as
   a "My stacks" entry, the legacy key is gone, and it is the open stack (REQ-5.3).
6. Rename a New Stack in the Edit-mode inspector: after the debounce, the "My stacks" label and the window title
   both show the new name (REQ-4.2).
7. Play the quiz without an authored edit, then reload: the quiz starts fresh and no entry was created (moved here
   from `sharing`; keeps REQ-3.2).
8. `test/e2e/sharing.spec.ts` is trimmed: the assertions this spec supersedes are deleted (the `AUTOSAVE_KEY`
   import, the single-autosave edit-survives-reload cases, the single-autosave fork, and "a visitor's own save
   survives following a link"); the share round-trip and export/import cases stay.

### REQ-8.3 — Playwright MCP

Acceptance criteria:
1. One run against the dev server exercises New Stack → edit → switch to a sample → switch back, then opens the
   picker to show both groups; the picker is shown at the 2x card width (a 1441-wide viewport) so the `<optgroup>`
   labels are legible, and the shot confirms the toolbar still fits with the extra Delete button. Screenshots are
   saved to `docs/screenshots/` (`library-picker.png`, `library-delete-confirm.png`).
2. The run reads the console at the end.
3. The run finishes by clearing `localStorage` so it leaves no library behind.

---

## REQ-9 — Constraints

- No change to `src/interp/`, `src/model/`, `fixtures`, `src/summon/` or `server/`; no new dependencies; files under
  ~300 lines.
- No server, no cloud sync; the library lives entirely in `localStorage`.
- No Save command or Save button; a stack that is open is saved.
- `src/share/` imports only `src/model/`; the boundary test enforces it.
- No `eval`, `new Function` or `innerHTML` in new code; stored stacks are validated with `validateStack` before
  load and never executed.
- `retro-ui.md` governs the picker groups and the Delete confirm; they are chrome and never touch the card
  surface.

---

## REQ-10 — Steering and brief amendment (Task 1)

### REQ-10.1 — Keep the docs honest

Acceptance criteria:
1. Task 1 amends steering `product.md` so the persistence section says the open stack and the person's other
   stacks are kept in a `localStorage` library (not a single autosave), in one or two short sentences.
2. Task 1 adds one short line under `docs/BRIEF.md` phase 2 item 0 noting that this spec implements it.
3. Both edits are short and change no other steering rule; `structure.md`'s `src/share/` → `src/model/` boundary is
   unchanged.

---

## Resolved decisions

These were the spec's open questions; the reviewer settled them.

1. Keys: `necrocard.library` for the index, `necrocard.library.entry.<id>` for each body.
2. Order "My stacks" by `updatedAt`, most recently edited on top.
3. Storage-failure status message: `Your library is full; that change was not saved.`
4. The migrated legacy entry is named by the fork rule (`<name> (your copy)`, REQ-5.3), not a fixed label.
5. Migration runs whenever the legacy key exists, regardless of whether the library is already non-empty (REQ-5.3).
6. Picker grouping is `<optgroup>` inside the existing native `<select>`; only what `retro-ui.md` already covers is
   styled.
7. An empty "My stacks" group is omitted entirely (REQ-6.1 criterion 5).
8. Rename is via the Edit-mode inspector (no dialog); an entry's name follows `stack.name` (REQ-4.2).
9. No explicit size cap; rely on the browser quota and REQ-1.5.
10. Task 1 amends steering `product.md` to say persistence is now the library, and adds one short line under
    `docs/BRIEF.md` phase 2 item 0 noting this spec. Both edits stay short.
