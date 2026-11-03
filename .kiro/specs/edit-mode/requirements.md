# edit-mode — Requirements

## Overview

Let the user change a stack in place: select, move, resize, nudge and delete objects; add buttons, fields and
images; edit every object property and every script through a 240 px inspector; add, delete and navigate cards;
undo and redo all of it. Edits change the same working copy that browse mode runs, so switching back to Browse runs
the edited stack immediately.

This is spec 4 of 8. It builds on `stack-model` (types, `generateId`, `validateStack`, `serializeStack`) and
`browse-mode` (stage, renderers, `DomHost`, `BrowseRuntime`, `BrowseState`).

Sources: `docs/BRIEF.md` sections 3 and 5 (edit mode, undo); steering `product.md`, `structure.md`, `retro-ui.md`
("Edit mode affordances", "Chrome vs. card surface", accessibility).

### In scope

Browse/Edit toggle; New Stack; edit-mode selection with outline and eight handles; move, resize and keyboard nudge with
integer rects; the inspector for object, card, background and stack properties and scripts (plain textarea);
add-object tools with default rects, generated ids and unique default names; image import with 1-bit ordered
dithering; delete; a card menu (new, delete, next, prev, card info); one linear undo/redo history; Vitest unit and
property tests; Playwright e2e; one Playwright MCP verification run.

### Out of scope

Persistence, autosave, export, sharing, Summon, the real script editor (highlighting, inline errors, Explain/Fix —
spec `script-editor`), paint tools, multi-selection, marquee selection, copy/paste, alignment guides, a background
editing mode (see open question 2), any change to `src/interp/` or `src/model/`, any new object type or property,
new runtime or dev dependencies.

---

## REQ-1 — Modes

### REQ-1.1 — Toggle

The chrome toolbar has a two-option mode control, "Browse" and "Edit", built as a `role="radiogroup"` of two
`role="radio"` buttons with `aria-checked`. Browse is the default after every stack load. The control is
disabled while the browse runtime is busy (a script, dialog or transition is running).

### REQ-1.2 — Surface state

The card surface carries `data-mode="browse" | "edit"`. In edit mode:

- the card layer is `inert`, so no element on the card can receive focus, clicks, or mouse messages, and unlocked
  fields cannot be typed into;
- an edit overlay covering the card surface receives all pointer input (REQ-2);
- the inspector (REQ-5) and the edit toolbar (tools, card menu, undo/redo) are shown;
- the message box is disabled (open question 7).

In browse mode the overlay, inspector and edit toolbar are removed from the layout and the card layer is
interactive again.

### REQ-1.3 — Shared working copy

Edit mode changes `BrowseState.stack` — the same object the browse runtime and `DomHost` read. There is no copy and
no "apply" step. Switching Edit → Browse:

1. commits any pending inspector input (REQ-5.4);
2. clears the selection;
3. re-renders the current card from the working copy;
4. sends no messages (open question 1).

The next click in browse mode dispatches through the edited scripts, because `dispatchMessage` parses scripts on
each dispatch. Globals are kept across mode switches. Switching Browse → Edit sends no messages either.

### REQ-1.4 — Stack load

Loading a stack (stack picker or New Stack) switches to Browse, clears the selection, and clears the undo history.

### REQ-1.5 — New Stack

A "New Stack" button in the chrome toolbar, available in both modes and disabled while the runtime is busy. It:

1. builds a stack with a fresh `generateId` id for the stack, the background and the card; one background named
   `Background 1` (no objects, empty script); one card named `Card 1` on that background (no objects, empty
   script); stack name `Untitled`; empty stack script; `metadata.created` and `metadata.modified` both set to
   `new Date().toISOString()`, `author: ''`;
2. checks it with `validateStack` (a failure shows `Could not create stack: <message>` and changes nothing);
3. loads it exactly like a fixture: Browse mode, `openStack` then `openCard` (both no-ops on empty scripts),
   selection and history cleared (REQ-1.4);
4. adds an `Untitled` option to the stack picker and selects it. The option is removed when a fixture is chosen.
   The `?stack=` query parameter is removed with `history.replaceState`, so a reload opens the default fixture
   (there is no persistence).

---

## REQ-2 — Selection and hit testing

### REQ-2.1 — Selectable objects

In edit mode the objects of the current card (`card.objects`) are selectable. Background objects are drawn but
not selectable or editable (open question 2). Hidden card objects (`visible: false`) are drawn in edit mode as a
1px dotted black outline at their rect, so they can be found and selected (open question 3).

### REQ-2.2 — Hit testing

A pointer position is converted to logical card pixels: `x = (clientX − surfaceLeft) / scale`,
`y = (clientY − surfaceTop) / scale`. The hit object is the topmost card object (last in `card.objects`) whose
rect contains the point, using half-open bounds `[x, x + w) × [y, y + h)`; hidden objects count. A handle of the
selected object, when hit, takes priority over objects (REQ-3.2).

### REQ-2.3 — Selecting

- Primary-button `pointerdown` on an object selects it (replacing any selection) and starts a potential move.
- `pointerdown` on empty card area, or Escape, clears the selection.
- Tab / Shift+Tab while the card surface has focus selects the next / previous card object in z-order, wrapping.
- Selection is not an undoable edit.
- Double-click on an object selects it and opens its script (REQ-5.6).

### REQ-2.4 — Selection display (retro-ui)

- Outline: 1px dashed black, 4px dash, 4px gap, drawn on the object's rect.
- Handles: eight 4 × 4 px solid black squares centred on the four corners and four edge midpoints of the rect.
- Drawn in the edit overlay above the card layer, scaled with the card (logical pixels), no opacity, no shadow.
- `data-selected-id` on the surface holds the selected object's id, or is absent.

---

## REQ-3 — Move, resize, nudge

### REQ-3.1 — Move

Dragging a selected or just-selected object moves it. The new position is
`x = startX + round((clientX − startClientX) / scale)` and the same for `y`, so positions are always whole
logical pixels at any scale. While dragging, only the object's element is repositioned; the model is changed once,
on release, as one history entry. A drag that ends where it started records nothing. Escape during a drag cancels
it and restores the start rect. Movement under 1 logical pixel does not start a drag, so a plain click never moves.

### REQ-3.2 — Resize

Dragging one of the eight handles resizes the selected object. Corner handles change two edges, edge handles one;
the opposite edge stays fixed. Deltas use the same rounding as REQ-3.1. Width and height never go below
`MIN_SIZE = 4` (open question 4); a handle cannot be dragged past the opposite edge. One history entry per
resize; Escape cancels.

### REQ-3.3 — Nudge

With an object selected and focus not in an editable control, Arrow keys move it by 1 logical pixel, Shift+Arrow
by 10. Consecutive nudges of the same object form one history entry until any other edit, undo/redo, selection
change, or mode switch.

### REQ-3.4 — Rect rules

Every rect written by edit mode — drag, resize, nudge, inspector, new object, image import — is passed through one
`clampRect` function:

- all four values are integers (`Math.round` on input);
- `w ≥ MIN_SIZE` and `h ≥ MIN_SIZE`;
- at least `MIN_SIZE` px of the object stays on the 512 × 342 card in each axis:
  `x ∈ [MIN_SIZE − w, 512 − MIN_SIZE]`, `y ∈ [MIN_SIZE − h, 342 − MIN_SIZE]`.

Existing rects from fixtures are not rewritten unless edited.

---

## REQ-4 — Add and delete

### REQ-4.1 — Tools

The edit toolbar has three tool buttons: "Add button", "Add field", "Add image". Each adds one object to the
current card's `objects` (on top, i.e. appended), selects it, and records one history entry.

### REQ-4.2 — Defaults

| Type | Default rect (centred on the card) | Other properties |
|---|---|---|
| button | 100 × 24 | `style: 'roundRect'`, `label` = name, `autoHilite: true`, `visible: true`, `script: ''` |
| field | 160 × 64 | `text: ''`, `lockText: false`, `style: 'rect'`, `visible: true`, `script: ''` |
| image | from the imported file (REQ-4.4) | `src` = dithered data URL, `visible: true`, `script: ''` |

Centred means `x = round((512 − w) / 2)`, `y = round((342 − h) / 2)`, then `clampRect`.

### REQ-4.3 — Ids and names

- `id` comes from `generateId()` in `src/model/id.ts`. If the id already exists anywhere in the stack (cards,
  backgrounds, objects, stack), a new one is generated, so ids stay unique within the stack.
- The default name is `Button N`, `Field N` or `Image N`, with the smallest `N ≥ 1` such that no object on the
  current card or its background has that name (case-insensitive).

### REQ-4.4 — Image import

"Add image", and "Import…" in the image inspector, open a file picker (`<input type="file" accept="image/*">`).
The chosen file:

- must have an `image/*` MIME type and be at most 5 MB; otherwise the status line shows
  `Could not import image: <reason>` and nothing changes;
- is decoded locally (`createImageBitmap`, or an `<img>` on an object URL that is revoked afterwards); no network
  request is made and nothing is uploaded;
- for "Add image": the rect size is the image's natural size scaled to fit inside 256 × 256, aspect ratio kept, at
  least `MIN_SIZE`; for "Import…": the selected image's current rect size;
- is drawn at exactly that size to an offscreen canvas, converted to 1-bit with the 8 × 8 Bayer ordered dither
  (luminance `0.299R + 0.587G + 0.114B`; pixels with alpha < 128 are white), and encoded as a PNG data URL
  (`data:image/png;base64,…`). Only the decoded file is read back, never the card DOM.

"Import…" replaces the image's `src` as one history entry. Resizing an image later scales its existing bitmap
(rendered `image-rendering: pixelated`); it is not re-dithered (open question 8).

### REQ-4.5 — Delete

Delete or Backspace, with an object selected and focus not in an editable control, removes it from
`card.objects`, clears the selection, and records one history entry. Undo puts it back at the same array index
with the same id.

---

## REQ-5 — Inspector

### REQ-5.1 — Placement and style

A 240 px wide panel to the right of the card, in edit mode only, using chrome styling (not 1-bit card rules).
Opening it shrinks the viewport, and the card re-fits (integer scale ≥ 1, as browse mode). It is a labelled
region (`<aside aria-label="Inspector">`), and every control has a visible `<label>`.

### REQ-5.2 — Object selected

Heading: `<Type> "<name>"` (e.g. `Button "Button 1"`). Controls:

| Section | Controls |
|---|---|
| Common | Name (text), X, Y, W, H (integer inputs, step 1), Visible (checkbox) |
| Button | Style (select: rect, roundRect, transparent), Label (text), Auto hilite (checkbox) |
| Field | Text (textarea), Lock text (checkbox), Style (select: rect, scrolling, transparent) |
| Image | Source (text input; data URLs are shown truncated and read-only, asset ids editable), Import… (button) |
| Script | Script (plain `<textarea class="font-script">`, spellcheck off) |

The inspector always shows the current model values; after undo/redo it re-reads them.

### REQ-5.3 — Nothing selected

Three sections:

- **Card**: Name (text), `Card <n> of <count>`, Script (textarea);
- **Background**: Name (read-only in this spec), Script (textarea);
- **Stack**: Name (text, editable; a commit is one `renameStack` history entry), Script (textarea).

### REQ-5.4 — Commit rules

- Text inputs, number inputs and textareas commit on `change` (blur, or Enter in single-line inputs). Checkboxes
  and selects commit on `change` immediately.
- A commit whose value equals the model value records nothing.
- X/Y/W/H must parse as integers (after trimming); invalid input reverts to the model value and shows
  `Enter a whole number` next to the control. Valid input goes through `clampRect`; if clamping changed it, the
  control shows the clamped value.
- Pending input is committed before any selection change, card change, undo/redo, tool use, mode switch, or
  keyboard edit (nudge, delete).
- Each commit is one history entry.

### REQ-5.5 — Names

Duplicate object names on the same card or background, and duplicate card names in the stack, are allowed (as in
HyperCard) but show the warning `Another <type> on this card has this name; scripts will find the first one.`
(or `Another card has this name; go to card "<name>" finds the first one.`). An empty name is allowed.

### REQ-5.6 — Scripts

- Every script — object, card, background, stack — is a plain textarea. `script-editor` replaces it later; this
  spec keeps the textarea behind one small interface so that swap is local (design).
- Under each script textarea a status line shows the parse result of the committed script with
  `parse` from `src/interp/parser.ts`: `No errors` or the `NecroTalkError` message (`Line 3: …`). A parse error
  does not block the commit; browse mode reports it when the script runs (open question 9).
- Double-click on an object selects it, scrolls its Script textarea into view, and focuses it.

---

## REQ-6 — Card menu

An edit-toolbar menu button "Card" opens a `role="menu"` list (keyboard: Enter/Space opens, Arrow keys move,
Escape closes) with:

| Item | Effect | History |
|---|---|---|
| New Card | Insert a card after the current one with the current card's `backgroundId`, `objects: []`, `script: ''`, id from `generateId`, name `Card N` (smallest unused N, case-insensitive across the stack); show it | one entry |
| Delete Card | Remove the current card; disabled when the stack has one card; show the card now at that index, or the new last card | one entry |
| Next / Prev | Show the next / previous card, wrapping, without messages (open question 1) | none |
| Card Info… | Chrome `<dialog>`: Name (editable), `Card <n> of <count>`, background name, number of card objects; OK commits a rename as one entry, Cancel discards | rename only |

The card menu exists in edit mode only (open question 10). Background deletion is never triggered: a background
with no cards left is kept in the stack.

---

## REQ-7 — Undo and redo

### REQ-7.1 — History

One linear history of edit commands per loaded stack. Undoable: move, resize, nudge run, add object, delete
object, every inspector property commit (name, rect, visible, style, label, autoHilite, text, lockText, src),
every script commit (object, card, background, stack), image import, new card, delete card, card rename, stack
rename.
Selection changes, card navigation and mode switches are not undoable.

### REQ-7.2 — Semantics

- Undo reverts the most recent applied command; redo re-applies the most recently undone one.
- Any new command after an undo discards the redo stack.
- Undo and redo show the card the command changed and select the object it changed (none for deleted objects or
  card-level commands).
- Cap: 500 entries; the oldest entry is dropped when full.
- Commands identify objects and cards by id, not by index or name, so they still apply after browse-mode scripts
  have changed other parts of the working copy.

### REQ-7.3 — Keys and controls

- Ctrl+Z (or ⌘Z) undo; Ctrl+Shift+Z (or ⌘⇧Z) redo. Ctrl+Y also redoes.
- Active in edit mode only, and not while focus is in a text input or textarea (native text undo applies there).
- Undo and Redo buttons in the edit toolbar, disabled when there is nothing to undo or redo, with `title`
  showing what will be undone (e.g. `Undo Move "Button 1"`).

### REQ-7.4 — Exactness

Applying any sequence of commands and then undoing all of them yields a working copy whose `serializeStack` output
is byte-for-byte identical to before the first command. Redoing all of them yields output byte-for-byte identical
to the state after the last command. Edit mode never touches `metadata` (open question 5).

---

## REQ-8 — Validity

- Every command keeps the working copy valid under `validateStack` from `src/model/validate.ts`. Tests call
  `validateStack` after every command they apply.
- In development builds (`import.meta.env.DEV`), the editor also validates after each command and logs a
  `console.error` with the ajv errors if validation fails. Production builds do not validate per edit.

---

## REQ-9 — Testing

### REQ-9.1 — Unit tests (Vitest)

Co-located `*.test.ts` for every module in `src/ui/edit/`. Pure modules (geometry, commands, history, naming,
dither) run in Node; DOM modules (overlay, inspector, card menu, editor) under `happy-dom`. DOM tests use an
inline stack with at least one background object to confirm background objects are not selectable.

### REQ-9.2 — Property-based tests (fast-check, ≥ 200 runs each)

1. **Geometry**: for any start rect, scale in `(0, 8]`, pointer deltas and handle, `moveRect`, `resizeRect` and
   `nudge` return rects that are integral, satisfy `clampRect` (min size, on-card margin), and leave the stack
   valid under `validateStack` when applied as commands.
2. **Undo restores**: for any fixture (`quiz`, `adventure`, `flashcards`) and any sequence of 1–30 random edits
   (move, resize, nudge, add button/field/image, delete, property set, script set, new card, delete card, card
   rename, stack rename) applied through the editor's command API, undoing all of them restores `serializeStack`
   byte for byte, and the stack is valid after every step.
3. **Redo replays**: after (2), redoing all of them yields the post-edit `serializeStack` byte for byte.

Ids in property tests come from an injected deterministic id generator; production uses `generateId`.

### REQ-9.3 — End-to-end (Playwright)

`test/e2e/edit.spec.ts`: load `/?stack=quiz`; switch to Edit; Add button; set its script in the inspector to
`on mouseUp` / `  go next` / `end mouseUp`; switch to Browse; click the new button by its accessible name; assert
`data-card-name` changed from `Title` to `Q1`. A second test imports a small generated PNG through the file input
and asserts the new image's `src` starts with `data:image/png;base64,` and that the page made no network request
other than to the dev server. A third test clicks New Stack, checks the picker shows `Untitled` and the card is
`Card 1`, switches to Edit, adds a button, sets its script to `on mouseUp` / `  set the label of me to "Clicked"` /
`end mouseUp`, switches to Browse, clicks it, and asserts its label is `Clicked`. `test/e2e/browse.spec.ts` keeps
passing.

A unit test asserts that the New Stack builder's output passes `validateStack`, has exactly one background, one
card on it, the names above, and `created === modified`.

### REQ-9.4 — Playwright MCP

The REQ-9.3 add-button flow is run once through Playwright MCP, with a screenshot of the edit mode selection and
inspector (`.playwright-mcp/edit-mode-selection.png`) and one of the result, and recorded in `KIRO_USAGE.md`.

---

## REQ-10 — Constraints

- New code lives in `src/ui/edit/` (including the New Stack builder), plus small additions to
  `src/ui/browse/domHost.ts`, `src/ui/browse/stage.ts`, `src/ui/browse/runtime.ts` and
  `src/ui/browse/stackPicker.ts` (the `Untitled` option), the chrome in `src/main.ts`, and `src/ui/chrome.css`.
- `src/ui/edit/` may import `src/model/` (types, `generateId`, `validateStack`, `serializeStack`), `src/interp/`
  (`parse` for the script status line, `NecroTalkError`), and `src/ui/browse/`. Nothing from `summon/`, `share/`,
  `worker/`.
- No change to `src/interp/` or `src/model/`. No new dependencies.
- retro-ui rules apply on the card surface: only `#000`/`#fff`, no gradients, shadows, opacity or CSS transitions;
  the selection outline and handles follow "Edit mode affordances"; inline styles only for rect positioning (and
  the exceptions retro-ui already lists).
- No `innerHTML` with stack content, no `eval`. Files under ~300 lines.
