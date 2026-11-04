# edit-background — Requirements

## Overview

Let the person edit a card's **background** layer in Edit mode, as HyperCard's Edit Background did. Today the editor
works only on the current card's own objects: background objects are drawn but cannot be selected, moved, renamed,
rescripted or deleted (edit-mode REQ-2.1). Summon puts shared controls — a persistent Next, Prev, Score, title bar —
on the background, so a summoned stack's navigation is stuck. An "Edit Background" toggle swaps which layer the
tools act on, so those shared objects become editable, and an edit to one shows on every card that shares the
background.

This is spec 10 and the second phase-2 item (`docs/BRIEF.md` phase 2, item 0b). It builds entirely on `edit-mode`
(the session, commands, history, overlay, pointer, inspector, card menu, edit toolbar) and lifts its REQ-2.1
restriction: the "which objects are selectable" rule becomes layer-dependent rather than always "the card's".

Browse mode and the interpreter are untouched. Background objects already render and run in Browse (the message
path is object → card → background → stack), so this spec changes only the editor's notion of the active layer.

Sources: `docs/BRIEF.md` phase 2 item 0b and section 5 (Edit mode); the `edit-mode` spec (REQ-2.1 selectable
objects, REQ-5 inspector, REQ-6 card menu, REQ-7 undo); steering `retro-ui.md` (the title-bar stripe and the menu
check are chrome, never the card surface) and `structure.md` (`src/ui/edit/` boundaries).

### In scope

A checkable "Edit Background" item in the Card menu with a `Ctrl+B` shortcut; session-only "edit background" state
(off after any load, off on leaving Edit, kept across card navigation); a layer-aware active-objects list so hit
testing, selection, move, resize, nudge, the add-object tools, Delete, the inspector, the script slot and
undo/redo all act on the background when on; hidden background objects shown with the dotted outline hidden card
objects get; one chrome-only indicator (a diagonal stripe on the window title bar plus the menu check); layer-aware
command owners for background objects so undo/redo restores to the right layer; Vitest unit and property tests;
happy-dom inspector and card-menu tests; Playwright e2e; one Playwright MCP run.

### Out of scope

Any change to Browse mode or `src/interp/` (background objects already run there); a separate background-editing
dialog (Card Info is unchanged, REQ-6); adding or deleting backgrounds, or moving an object between a card and its
background; multi-background cards (a card has one background, as in `stack-model`); editing a background that no
card currently shows; a card-surface indicator of the mode; any change to `src/model/`, `fixtures/`, `src/summon/`,
`server/`, `src/share/`; new dependencies.

---

## REQ-1 — The Edit Background toggle

### REQ-1.1 — Menu item and shortcut

The Card menu (edit-mode REQ-6) gains a checkable "Edit Background" item. `Ctrl+B` (or `⌘B`) toggles it, matching
HyperCard's Cmd-B.

Acceptance criteria:
1. The Card menu lists "Edit Background" as a `role="menuitemcheckbox"` with `aria-checked` reflecting the state.
2. Choosing the item, or pressing `Ctrl+B` / `⌘B` while in Edit mode and not in a text control, toggles the state.
3. The shortcut is active in Edit mode only; in Browse mode `Ctrl+B` does nothing editor-related.
4. `Ctrl+B` does not fire when focus is in a text input, textarea, select, or an open dialog (as the other editor
   shortcuts in edit-mode REQ-7.3).
5. The handler calls `preventDefault` only when it consumes the key (Edit mode, not in a text control), so the
   browser's own `Ctrl+B` (for example Firefox's bookmarks sidebar) still works in Browse mode and in text fields.

### REQ-1.2 — Session state, not stored

Edit-background is session state on the editor, never written to the stack.

Acceptance criteria:
1. The state is held by the editor/session, not on `Stack`, `Card`, or any object; `serializeStack` output is
   unaffected by toggling it.
2. It is off after every stack load (New Stack, picker, Summon, Import, share, library entry) — the same reset
   edit-mode REQ-1.4 does for selection and history.
3. It is off whenever Edit mode is entered (entering Edit always starts on the card layer) and is cleared on
   leaving Edit mode.
4. It is kept while navigating between cards within one Edit session (Next/Prev, New Card, the card menu), so a
   person can edit the shared background across several cards without re-toggling.
5. New Card while edit-background is on keeps it on (the new card shares the current background) and clears the
   selection.

### REQ-1.3 — Toggling clears the selection

Acceptance criteria:
1. Toggling edit-background commits any pending inspector input (edit-mode REQ-5.4), then clears the selection
   (the selected object belongs to the layer being left).
2. Toggling is not itself an undoable edit and does not bump the history revision (no autosave/fork is triggered by
   the toggle alone).
3. After toggling, the overlay, inspector and toolbar refresh to the now-active layer.
4. A pointer drag in progress is cancelled first (restoring the start rect), as Escape does, before the toggle
   takes effect.

---

## REQ-2 — The active layer

"Active layer" means the set of objects the editor currently acts on: the current card's `objects` when
edit-background is off, or the current card's background's `objects` when on.

### REQ-2.1 — Selectable objects (lifts edit-mode REQ-2.1)

Acceptance criteria:
1. With edit-background **off**, the current card's objects are selectable and the background's objects are drawn
   but not selectable — exactly edit-mode REQ-2.1 today.
2. With edit-background **on**, the current card's background's objects are selectable and the card's own objects
   are drawn but not selectable — the mirror of (1).
3. Hit testing (edit-mode REQ-2.2), `pointerdown` selection, Tab / Shift+Tab z-order cycling, and double-click to
   open a script all operate on the active layer's objects only.
4. A pointer on a non-active-layer object (a card object while editing the background, or vice versa) hits empty
   space: it clears the selection, it does not select the drawn-but-inactive object.

### REQ-2.2 — Hidden objects on the active layer

Acceptance criteria:
1. Hidden objects (`visible: false`) on the active layer are drawn in the overlay as the 1px dotted black outline
   edit-mode REQ-2.1 gives hidden card objects, so they can be found and selected.
2. When edit-background is on, hidden **background** objects get that outline; hidden card objects do not (they are
   on the inactive layer).

### REQ-2.3 — Move, resize, nudge, add, delete on the active layer

Acceptance criteria:
1. Move, resize and nudge (edit-mode REQ-3) act on the selected active-layer object with the same rounding, clamp
   and single-history-entry rules.
2. The add-object tools — New Button, New Field, Add image (edit-mode REQ-4) — append to the active layer's
   `objects` (the background's when on), select the new object, and record one history entry.
3. Delete / Backspace (edit-mode REQ-4.5) removes the selected active-layer object and undo restores it at the same
   index on the same layer.
4. The default-name uniqueness for a new object spans the card and its background both (edit-mode REQ-4.3), whether
   the new object lands on the card or the background; this cross-layer check is unchanged.

---

## REQ-3 — The indicator (chrome only)

HyperCard hatched the whole menu bar while editing the background. Here the single unmistakable indicator is in the
chrome: a diagonal-stripe pattern on the window's title bar, plus the menu item's check. Nothing on the card
surface changes.

### REQ-3.1 — Striped title bar

Acceptance criteria:
1. While edit-background is on, the window title bar (`.card-window-title`) shows a diagonal 1-bit stripe pattern,
   built from the existing stripe/tile vocabulary already used there (the title bar is chrome, where
   `retro-ui.md` already permits a stripe; the card surface is untouched).
2. The title bar returns to its normal horizontal-stripe look when edit-background is off, and in Browse mode.
3. The stack name stays readable on the striped bar (the label keeps its solid background, as it does over the
   existing horizontal stripes).
4. No rule scoped to `.card-surface` changes; the card-surface CSS guard stays green.

### REQ-3.2 — Menu check

Acceptance criteria:
1. While on, the "Edit Background" menu item shows its check (`aria-checked="true"` and a visible check mark in the
   menu).
2. The indicator state (stripe + check) always matches the session state after any toggle, card navigation, or
   refresh.

---

## REQ-4 — Shared edits are visible across cards

### REQ-4.1 — One background, many cards

Acceptance criteria:
1. An edit to a background object (move, resize, rename, property, script, add, delete) changes the one background
   record, so every card that shares that background shows it.
2. Moving to another card that uses the same background (Next/Prev) shows the change already applied — there is no
   per-card copy of a background object.
3. The worked example creates the shared background object itself (no bundled fixture has one — all three
   fixtures have an empty background, and Next/Prev there are card objects): with edit-background on, New Button
   lands on the flashcards background; moving to another card that shares the background then shows it there too.

### REQ-4.2 — Live render

Acceptance criteria:
1. After an active-layer edit the current card re-renders from the working copy (edit-mode refresh), so a
   background change is visible immediately on the current card too, not only after navigation.

---

## REQ-5 — Layer-aware commands, owners and undo

### REQ-5.1 — Object commands name a layer

The edit-mode commands that target an object by `cardId` (`setRect`, `setProp`, `addObject`, `removeObject`) must
be able to name a **background** instead, so they apply to and undo on the right layer.

Acceptance criteria:
1. An object command identifies its container as either a card or a background (by id), not always a card.
2. `applyCommand` resolves the object on the named layer; undo and redo restore it to that same layer.
3. A command whose layer or object no longer exists throws `CommandError` and changes nothing (as today), so a
   stale command never corrupts the stack.
4. The exactness guarantee (edit-mode REQ-7.4) holds across layers: any sequence of commands on either layer,
   undone in full, yields a `serializeStack` output byte-for-byte identical to before the first command; redone in
   full, identical to after the last.

### REQ-5.2 — Script owners

Acceptance criteria:
1. A background object's script is owned by a `{ kind: 'object', backgroundId, objectId }`-style owner (the
   existing `ScriptOwner` already has a `background` kind for the background's own script; object-on-background
   owners extend the object owner to name a background). Undo/redo of a background object's script restores it on
   the background.
2. The background's own script remains editable through the inspector's Background section (edit-mode REQ-5.3), as
   today; this spec does not change that path.

### REQ-5.3 — Focus after undo/redo (never changes the layer)

Undo and redo never switch the active layer. They apply the command, show a card that holds the affected object,
and select the object only when it is on the current active layer; otherwise the selection stays clear. The change
is still visible because the inactive layer is drawn. (A mode that flipped as a side effect of undo would surprise,
and HyperCard's undo did not switch modes.)

Acceptance criteria:
1. Undo/redo of a command leaves edit-background exactly as it was; the toggle, stripe and menu check do not move.
2. It shows a card that contains the affected object and, when that object is on the active layer, selects it.
3. When the affected object is on the inactive layer (a background object while editing the card, or a card object
   while editing the background), the selection is cleared and no inactive-layer object is selected; the restored
   change is visible on the drawn inactive layer.

### REQ-5.4 — Naming uniqueness is unchanged

Acceptance criteria:
1. The duplicate-name warning (edit-mode REQ-5.5) still spans a card and its background together, so a background
   object named like a card object on a sharing card still warns. No change is needed here; a test confirms it
   still holds when the background is the active layer.

---

## REQ-6 — Inspector and Card Info

### REQ-6.1 — Inspector follows the active layer

Acceptance criteria:
1. With edit-background on and a background object selected, the inspector shows that object's heading, common,
   type-specific and script sections (edit-mode REQ-5.2), editing the background object.
2. With edit-background on and nothing selected, the inspector's "nothing selected" view (edit-mode REQ-5.3) is
   shown as today (Card, Background, Stack sections); the Background section's script still edits the background
   script.
3. Every inspector commit on a background object is one history entry on the background layer (REQ-5.1).

### REQ-6.2 — Card Info unchanged

Acceptance criteria:
1. Card Info (edit-mode REQ-6) still shows the background name and the current card's object count; no new dialog
   and no background-specific dialog is added.

---

## REQ-7 — Testing

### REQ-7.1 — Unit tests (Vitest)

Acceptance criteria:
1. Session (`session.test.ts` additions): toggling the layer switches which objects `select`, `selected`,
   `addObject`, `deleteSelected`, move/resize/nudge and the inspector view act on; the state is off after a load
   and on leaving Edit, and kept across `showCard`; toggling clears the selection and does not bump the revision.
2. Commands (`commands.test.ts` additions): an object command naming a background applies, undoes and redoes on the
   background; a command naming a missing background throws `CommandError` and changes nothing.
3. Inspector and card menu (happy-dom): the card menu renders a checkable "Edit Background" item whose
   `aria-checked` tracks a callback; selecting a background object shows its inspector heading and sections.

### REQ-7.2 — Property-based test (fast-check, ≥ 200 runs)

Acceptance criteria:
1. For any fixture and any sequence of 1–30 random edits where each edit is applied on a randomly chosen active
   layer (card or background) through the editor/session API, undoing all of them restores `serializeStack`
   byte-for-byte, redoing all of them reproduces the post-edit output byte-for-byte, and the stack is valid under
   `validateStack` after every step (extends edit-mode REQ-9.2 to both layers).

### REQ-7.3 — End-to-end (Playwright, `test/e2e/edit-background.spec.ts`)

The fixtures are protected and have empty backgrounds, so the test creates the background object itself.

Acceptance criteria:
1. Open `/?stack=flashcards`, switch to Edit, toggle Edit Background (menu or `Ctrl+B`): the title bar shows the
   striped indicator and the menu item is checked.
2. New Button: it lands on the background (the active layer); assert it is selected.
3. Go to the next card via the Card menu and confirm the same new button appears there (shared background,
   REQ-4.1).
4. Move the new button on that card; go back to the first card and confirm it is moved there too.
5. Undo: the button returns to its original position.
6. Toggle Edit Background off: the stripe is gone; the card's own Next button is selectable again, and the new
   background button is no longer selectable.

### REQ-7.4 — Playwright MCP

The fixtures are protected, so the run creates the background object itself; editing a sample forks a library copy
(`stack-library` REQ-2.2), so the run clears storage at the end.

Acceptance criteria:
1. One run against the dev server: open flashcards, Edit, toggle Edit Background, New Button (it lands on the
   background and is selected), and screenshot the striped title bar with the selected background button to
   `docs/screenshots/` (`edit-background.png`).
2. The run reads the console at the end.
3. The run finishes by clearing `localStorage` so it leaves no forked library copy behind.

---

## REQ-8 — Constraints

- Changes live in `src/ui/edit/` (`commands.ts`, `session.ts`, `history.ts` if needed, `overlay.ts`, `pointer.ts`
  / `editorInput.ts`, `inspector.ts`, `cardMenu.ts`, `editToolbar.ts`, `edit.css`) and whatever small wiring
  `src/main.ts` needs (the `Ctrl+B` shortcut and the title-bar stripe class toggle).
- No change to `src/interp/`, `src/model/`, `fixtures/`, `src/summon/`, `server/` or `src/share/`; no new
  dependencies; files under ~300 lines.
- `retro-ui.md` governs the title-bar stripe and the menu check: chrome only, 1-bit, and no rule scoped to
  `.card-surface`; the card-surface guard test stays green.
- No `eval`, no `innerHTML` with stack content.
- Browse mode and the interpreter are untouched: background objects already render and run there.

---

## Resolved decisions

These were the spec's open questions; the reviewer settled them.

1. Undo/redo never changes the active layer (REQ-5.3): it applies the command, shows a card holding the object,
   and selects the object only if it is on the active layer; otherwise the selection stays clear. The change is
   visible because the inactive layer is drawn.
2. The diagonal stripe is a 45° `repeating-linear-gradient`, built like the existing horizontal title stripe, so
   no new asset is added (REQ-3.1).
3. The menu-item check is CSS-drawn, like the existing CSS-drawn Card-menu caret (REQ-3.2).
4. The shortcut hint on the menu item is the plain text `Ctrl+B` (the bundled fonts have no `⌃` glyph), shown
   right-aligned and non-focusable; the same text is used on macOS (REQ-1.1).
5. New Card while edit-background is on keeps it on and clears the selection (REQ-1.2 criterion 5, below).
6. Toggling edit-background cancels a drag in progress first, as Escape does (REQ-1.3 criterion 4, below).
