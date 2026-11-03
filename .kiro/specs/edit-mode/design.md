# edit-mode — Design

## Module map

```
src/ui/edit/
├── geometry.ts          # MIN_SIZE, clampRect, moveRect, resizeRect, nudgeRect, handlePoints, hitTest — pure
├── commands.ts          # Command union, applyCommand, invertCommand, describeCommand — pure, on Stack
├── history.ts           # History: push (with coalescing), undo, redo, cap 500 — pure
├── naming.ts            # uniqueObjectName, uniqueCardName, uniqueId(stack, gen) — pure
├── newStack.ts          # createNewStack(now, idGen) → validated Stack (REQ-1.5)
├── objectFactory.ts     # defaultRect(type), makeButton, makeField, makeImage — pure
├── session.ts           # EditSession: selection + history + all edit operations over BrowseState — no DOM
├── dither.ts            # ditherRgba(rgba, w, h) → bits; fitWithin(w, h, max) — pure
├── png.ts               # encodeBitsPng(bits, w, h) → data URL; 1-bit grayscale PNG, stored deflate — pure
├── imageImport.ts       # file → checks → decode → canvas → dither → PNG; decode injectable
├── overlay.ts           # EditOverlay: hidden-object outlines, dashed selection outline, 8 handles
├── pointer.ts           # pointer → logical coords; drag state machine for move / resize
├── inspector.ts         # Inspector panel: object view and card/background/stack view
├── inspectorControls.ts # labelled text/number/checkbox/select/textarea controls with commit-on-change
├── scriptSlot.ts        # ScriptEditorSlot interface + createPlainScriptSlot (textarea + parse status)
├── cardMenu.ts          # "Card" menu button + role=menu list; Card Info <dialog>
├── editToolbar.ts       # tools, card menu, undo/redo buttons
├── modeToggle.ts        # Browse/Edit radiogroup
├── editor.ts            # EditController: lifecycle, operations, re-render (session ↔ DOM)
├── editorInput.ts       # pointer (select, move, resize, double-click) and keyboard bindings for the controller
├── edit.css             # overlay, handles, outlines (card surface, 1-bit) + inspector/toolbar (chrome)
└── *.test.ts
test/e2e/edit.spec.ts
```

Small additions outside `src/ui/edit/`:

| File | Addition |
|---|---|
| `src/ui/browse/domHost.ts` | `showCard(index)`: render that card, no messages, no transition, pending effect untouched; `rerender()`: re-render the current card from the working copy (named `rerender` to stay distinct from the private per-object `updateObject`, formerly `refresh`); `elementFor(objectId)` for live drag previews |
| `src/ui/browse/stage.ts` | `setEditing(on)`: sets `data-mode`, applies `inert` to the current card layer and to every layer set later while on; `setSelected(id \| null)` for `data-selected-id`; `tabIndex = 0` while editing; `isEditing` |
| `src/ui/browse/runtime.ts` | `setMode(mode)`: in edit mode the gesture handlers and `runMessageBox` return early (in addition to `inert` and the disabled input); `onLoad` callback option so the editor can reset |
| `src/ui/browse/stackPicker.ts` | `showUntitled()` / removal of the `Untitled` option (REQ-1.5) |
| `src/main.ts` | Mode toggle, New Stack button, edit toolbar row, workspace row (viewport + inspector) |
| `src/ui/chrome.css` | `.workspace`, `.edit-toolbar` layout |

### Dependency graph (runtime imports)

```
main.ts → editor, modeToggle, editToolbar, (browse modules as today)
editor → session, overlay, pointer, inspector, editToolbar, cardMenu, imageImport, browse/{domHost, stage, runtime}
session → commands, history, naming, objectFactory, geometry, model/{id, validate (DEV only)}
inspector → inspectorControls, scriptSlot, geometry, naming
scriptSlot → interp/parser (parse), interp/errors
imageImport → dither, png, geometry
commands, history, naming, objectFactory, geometry, dither, png → model/types (types only)
```

`session.ts` has no DOM access, so the property tests drive it directly in Node.

---

## geometry.ts (pure)

```ts
export const MIN_SIZE = 4;
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export function clampRect(r: Rect): Rect;
export function moveRect(start: Rect, dxLogical: number, dyLogical: number): Rect;
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number): Rect;
export function nudgeRect(r: Rect, dx: number, dy: number): Rect;
export function toLogicalDelta(clientDelta: number, scale: number): number;   // Math.round(d / scale)
export function handlePoints(r: Rect): Record<Handle, { x: number; y: number }>;
export function hitHandle(r: Rect, x: number, y: number): Handle | null;      // 4×4 squares centred on points
export function hitTest(objects: readonly CardObject[], x: number, y: number): CardObject | null; // topmost
```

`clampRect` (REQ-3.4):

```
w = max(MIN_SIZE, round(w)); h = max(MIN_SIZE, round(h))
x = clamp(round(x), MIN_SIZE - w, 512 - MIN_SIZE)
y = clamp(round(y), MIN_SIZE - h, 342 - MIN_SIZE)
```

`resizeRect` moves only the dragged edges: for `w`/`nw`/`sw` the right edge `x + w` is fixed and
`x' = min(x + dx, x + w - MIN_SIZE)`; for `e`/`ne`/`se`, `w' = max(MIN_SIZE, w + dx)`; same for vertical. Then
`clampRect`. The result is always integral because the inputs are rounded logical deltas.

---

## commands.ts (pure)

Every edit is a serialisable command that names its targets by id and carries both before and after values, so
it can be applied and inverted without looking anything up by position or name.

```ts
export type ObjectProp =
  | 'name' | 'visible' | 'style' | 'label' | 'autoHilite' | 'text' | 'lockText' | 'src';

export type ScriptOwner =
  | { kind: 'object'; cardId: string; objectId: string }
  | { kind: 'card'; cardId: string }
  | { kind: 'background'; backgroundId: string }
  | { kind: 'stack' };

export type Command =
  | { kind: 'setRect'; cardId: string; objectId: string; before: Rect; after: Rect; reason: 'move' | 'resize' | 'nudge' | 'inspector' }
  | { kind: 'setProp'; cardId: string; objectId: string; prop: ObjectProp; before: string | boolean; after: string | boolean }
  | { kind: 'setScript'; owner: ScriptOwner; before: string; after: string }
  | { kind: 'addObject'; cardId: string; index: number; object: CardObject }
  | { kind: 'removeObject'; cardId: string; index: number; object: CardObject }
  | { kind: 'insertCard'; index: number; card: Card }
  | { kind: 'removeCard'; index: number; card: Card }
  | { kind: 'renameCard'; cardId: string; before: string; after: string }
  | { kind: 'renameStack'; before: string; after: string };

export function applyCommand(stack: Stack, cmd: Command): void;   // mutates; throws CommandError if a target is missing
export function invertCommand(cmd: Command): Command;             // add↔remove, insert↔remove, swap before/after
export function describeCommand(cmd: Command, stack: Stack): string; // "Move \"Button 1\"", "New Card", …
```

- Objects, cards and rects stored in commands are `structuredClone`d when the command is built, and cloned again
  when applied, so later mutations of the working copy never alias history.
- `applyCommand` checks the object type for `setProp` (e.g. `label` only on buttons) and that `removeObject` /
  `removeCard` find the expected id at `index`. Mismatches throw `CommandError`; nothing is changed.
- Because `serializeStack` sorts keys, only array order matters for byte-exact undo; add/remove and insert/remove
  restore the exact index.

## history.ts (pure)

```ts
export class History {
  constructor(cap = 500);
  push(cmd: Command, coalesceKey?: string): void;  // merges into the top entry when the key matches and the top is open
  seal(): void;                                     // closes the top entry for coalescing
  undo(): Command | null;                           // returns the inverse to apply
  redo(): Command | null;
  canUndo / canRedo / peekUndo / peekRedo / clear()
}
```

Coalescing merges two `setRect` commands on the same object: the merged entry keeps the earlier `before` and the
later `after`. The editor uses key `nudge:<objectId>` and calls `seal()` on every other operation (REQ-3.3). A push
clears the redo stack. At the cap the oldest entry is dropped.

## naming.ts / objectFactory.ts (pure)

- `uniqueId(stack, gen = generateId)` loops until the id is not used by the stack, any background, card or object.
- `uniqueObjectName(stack, cardIndex, type)` → `Button N` etc., smallest N not used (case-insensitive) on the card
  or its background.
- `uniqueCardName(stack)` → `Card N`, smallest N not used by any card.
- `defaultRect(type)`: button 100 × 24, field 160 × 64, both centred and clamped; images get their size from the
  import (`fitWithin(natural, 256)`).

## newStack.ts (pure apart from the clock and id generator)

```ts
export function createNewStack(now = new Date(), idGen = generateId): Stack;
```

Builds the REQ-1.5 stack (distinct ids from `idGen`, `Background 1`, `Card 1`, `Untitled`, empty scripts,
`created === modified === now.toISOString()`, `author: ''`) and returns `validateStack(stack)`. `main.ts` calls it
from the New Stack button and loads the result through the same path as a fixture; `stackPicker.ts` gains
`showUntitled()` (adds and selects an `Untitled` option, value `untitled`) and removes it again when a fixture is
chosen.

---

## session.ts — EditSession (no DOM)

```ts
export interface SessionEvent {
  /** Card that should be shown (after undo/redo or card ops), if it changed. */
  cardIndex?: number;
  /** Object to select afterwards; null clears. Undefined keeps the selection. */
  select?: string | null;
  /** Whether the card must be re-rendered. */
  render: boolean;
}

export class EditSession {
  constructor(state: BrowseState, options?: { idGen?: () => string; validate?: (s: Stack) => void });
  readonly history: History;
  selection: string | null;

  select(id: string | null): void;                         // seals history
  moveTo(id: string, rect: Rect, reason: 'move' | 'resize' | 'inspector'): SessionEvent | null;
  nudge(dx: number, dy: number): SessionEvent | null;      // coalesced
  setProp(id: string, prop: ObjectProp, value: string | boolean): SessionEvent | null;
  setScript(owner: ScriptOwner, script: string): SessionEvent | null;
  addObject(type: 'button' | 'field'): SessionEvent;
  addImage(src: string, w: number, h: number): SessionEvent;
  deleteSelected(): SessionEvent | null;
  newCard(): SessionEvent;
  deleteCard(): SessionEvent | null;                       // null when only one card
  renameCard(cardId: string, name: string): SessionEvent | null;
  renameStack(name: string): SessionEvent | null;
  showCard(index: number): SessionEvent;                   // navigation, not undoable
  undo(): SessionEvent | null;
  redo(): SessionEvent | null;
}
```

Every mutating method builds a command, runs `applyCommand(state.stack, cmd)`, pushes it, runs the `validate`
option (tests pass `validateStack`; the editor passes it in DEV builds and logs instead of throwing), and returns a
`SessionEvent`. No-op edits (value unchanged) return `null` and push nothing. `undo`/`redo` apply the inverse or
original and return the card index of the affected card and the object to select. If a command no longer applies
(a script deleted its target in browse mode — impossible today, but guarded), `CommandError` is caught, the status
line shows `Cannot undo: <reason>`, and the history position is left where it was.

---

## Rendering in edit mode

The card itself is still rendered by browse-mode code. After every `SessionEvent` with `render: true` the editor
calls `host.rerender()`, or `host.showCard(i)` if the card changed. `CardStage.setEditing(true)` keeps every new card
layer `inert`. During a drag, only the dragged element's inline `left/top/width/height` and the overlay are updated
(no model change, no re-render); release commits once.

Hidden objects stay `hidden` in the card layer; the overlay draws them (REQ-2.1). The overlay sits above the card
layer and below dialogs: `--z-edit-overlay: 50`.

### overlay.ts

```
.edit-overlay (absolute, inset 0, receives pointer events)
├── .edit-hidden-outline × n        1px dotted #000 at each hidden card object's rect
└── .edit-selection (when selected)
    ├── <svg> rect x=.5 y=.5 w-1 h-1, stroke #000, stroke-dasharray "4 4", shape-rendering crispEdges, fill none
    └── .edit-handle[data-handle] × 8   4×4 #000, centred on handlePoints
```

All positions are inline `left/top/width/height` (rect positioning, allowed). The dashed outline is SVG because CSS
`dashed` borders cannot set dash and gap lengths. Handle `cursor` values (`nwse-resize`, …) are the only chrome-like
touch on the surface. There is no 50% drag ghost: the real element moves (open question 13), so the edit mode
"drag ghost" opacity exception is not used.

### pointer.ts

```ts
export function clientToLogical(e: { clientX: number; clientY: number }, surfaceRect: DOMRect, scale: number): { x: number; y: number };
export type Drag =
  | { kind: 'move'; id: string; start: Rect; startClient: { x: number; y: number } }
  | { kind: 'resize'; id: string; handle: Handle; start: Rect; startClient: { x: number; y: number } };
export function dragRect(d: Drag, clientX: number, clientY: number, scale: number): Rect;
```

The overlay uses pointer capture (its own element) for the drag. `pointerdown`: handle hit → resize drag; object
hit → select + move drag; empty → deselect. `pointermove` → `dragRect` → live preview. `pointerup` → if rect
changed, `session.moveTo(...)`. `pointercancel` or Escape → restore the start rect.

---

## Inspector

### inspectorControls.ts

Factories returning `{ el, set(value), focus() }` with a visible `<label>`, unique ids, and an `onCommit` callback
fired on `change` only when the value differs from the last value set. Number inputs parse with
`/^-?\d+$/` after trim; invalid input reverts and shows `Enter a whole number` (`aria-describedby`). A `flush()`
helper blurs-and-commits the focused control; the editor calls it before every other operation (REQ-5.4).

### scriptSlot.ts

```ts
export interface ScriptEditorSlot {
  readonly el: HTMLElement;
  set(source: string): void;
  onCommit(cb: (source: string) => void): void;
  focus(): void;
}
export function createPlainScriptSlot(label: string): ScriptEditorSlot;
```

A labelled `<textarea class="font-script">` (spellcheck off, 10 rows) plus a status line that shows `No errors` or
the `parse` error message after each commit and on `set`. `script-editor` replaces only this factory.

### inspector.ts

`Inspector.show(view)` where `view` is `{ kind: 'object', obj, card, bg }` or
`{ kind: 'card', stack, cardIndex }`. It rebuilds the DOM when the view's identity changes (different object, or
object ↔ card view) and otherwise only calls `set` on every control except the focused one, so typing is never
interrupted by a re-sync. Duplicate-name warnings (REQ-5.5) are computed on each `set`.

---

## Image import

### dither.ts (pure)

```ts
export function fitWithin(w: number, h: number, max: number): { w: number; h: number }; // ≥ MIN_SIZE, aspect kept
export function ditherRgba(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array;  // 1 = black, row-major
```

Threshold per pixel `(x, y)`: luminance `L = 0.299R + 0.587G + 0.114B` (0–255); alpha < 128 → white; black when
`L < (BAYER_8[(y % 8) * 8 + x % 8] + 0.5) * 4`. `BAYER_8` is reused from `src/ui/browse/ditherMask.ts`.

### png.ts (pure)

`encodeBitsPng(bits, w, h)` writes a 1-bit grayscale PNG (IHDR colour type 0, bit depth 1; 1 = white in PNG, so
bits are inverted), one `IDAT` with filter byte 0 per row, wrapped in a zlib stream of "stored" deflate blocks (no
compression library): `storedDeflate(raw)` writes the data in a loop of blocks of at most 65,535 bytes each
(`BFINAL` set only on the last), then Adler-32; chunks carry CRC-32. Returns `data:image/png;base64,…`. The largest
image the editor makes, 512 × 342, is 65 × 342 = 22,230 raw bytes — one block — so the multi-block path is tested
directly through `storedDeflate` with more than 65,535 bytes as well as with a full 512 × 342 bitmap. A 256 × 256
image is about 11 KB of base64. Pure and deterministic, so it is unit-tested in Node by decoding the chunks back.

### imageImport.ts

```ts
export interface ImportDeps {
  decode(file: File): Promise<{ width: number; height: number; draw(w: number, h: number): Uint8ClampedArray }>;
}
export async function importImage(file: File, size: { w: number; h: number } | 'fit', deps?: ImportDeps): Promise<{ src: string; w: number; h: number }>;
```

The default `decode` uses `createImageBitmap(file)` and an `OffscreenCanvas` (or a detached `<canvas>`) to draw
at the target size and read `getImageData`; the bitmap is closed afterwards. Checks: `file.type.startsWith('image/')`
and `file.size <= 5 * 1024 * 1024`; errors are `ImageImportError` with a plain-English reason. No `fetch`, no
`XMLHttpRequest`, no remote URL is ever created.

---

## Card menu (cardMenu.ts)

A chrome `<button aria-haspopup="menu" aria-expanded>` labelled "Card" and a `<ul role="menu">` of
`<li role="none"><button role="menuitem">`. Arrow keys move focus, Escape closes and returns focus to the menu
button, clicking outside closes. "Delete Card" has `aria-disabled="true"` and does nothing when there is one card.
Card Info uses a chrome `<dialog>` with `showModal()` (chrome, not the card surface, so the top layer is fine):
Name input, read-only lines for position, background and object count, Cancel and OK.

---

## EditController (editor.ts)

```ts
export class EditController {
  constructor(deps: { stage: CardStage; runtime: BrowseRuntime; status: StatusLine; inspectorHost: HTMLElement; toolbarHost: HTMLElement });
  enter(): void;     // Browse → Edit
  exit(): void;      // Edit → Browse (flush, deselect, refresh, no messages)
  reset(): void;     // on stack load: exit, clear history
  readonly mode: 'browse' | 'edit';
}
```

- `enter()`: requires `!runtime.isBusy`; `runtime.setMode('edit')`; `stage.setEditing(true)`; build an
  `EditSession` over `runtime.currentState` (re-created on each stack load, so history is per stack); mount the
  overlay, inspector and edit toolbar; show the card view in the inspector.
- Keyboard: one `keydown` listener on the document while in edit mode. It ignores events whose target is an
  editable control (`input`, `textarea`, `select`, `[contenteditable]`) or that happen while a `<dialog>` is open,
  except that undo/redo shortcuts are also ignored inside editable controls (native text undo). It handles
  Delete/Backspace, Arrow (+Shift), Escape, Tab/Shift+Tab (when the surface has focus), Ctrl/⌘+Z, Ctrl/⌘+Shift+Z,
  Ctrl+Y.
- Every operation calls `inspector.flush()` first, then the session, then `apply(event)`: show/refresh the card,
  update `stage.setSelected`, the overlay, the inspector and the undo/redo buttons.
- Double-click: select, then `inspector.focusScript()`.
- `exit()`: `inspector.flush()`, `session.select(null)`, unmount, `stage.setEditing(false)`, `host.rerender()`,
  `runtime.setMode('browse')`. No messages.
- The message box is disabled while in edit mode and re-enabled on exit (unless the runtime is busy).

---

## Chrome layout

```
header.chrome-toolbar     NecroCard · Stack [picker] · [New Stack] · [Browse | Edit]
div.edit-toolbar          [Add button] [Add field] [Add image] [Card ▾] [Undo] [Redo]     (edit mode only)
div.workspace             main.card-viewport (flex 1)  |  aside.inspector (240px, edit mode only)
div.status-line
input.message-box
```

The viewport re-fits on resize via its existing `ResizeObserver`, so entering edit mode can drop the scale from 2× to
1× on narrower windows. That is expected.

---

## Testing strategy

| File | Env | Covers |
|---|---|---|
| `geometry.test.ts` | node | clampRect bounds, resize per handle, hitTest topmost/half-open, PBT #1 (with `validateStack`) |
| `commands.test.ts` | node | apply/invert per kind, clone isolation, CommandError on mismatch |
| `history.test.ts` | node | undo/redo order, redo cleared on push, nudge coalescing + seal, cap 500 |
| `naming.test.ts` | node | unique names case-insensitive across card + background, unique card names, id collision retry |
| `newStack.test.ts` | node | output passes `validateStack`; one background, one card on it; names; `created === modified`; distinct ids |
| `png.test.ts` | node | signature, IHDR fields, CRCs, Adler-32, decoded bits round-trip; 512 × 342 bitmap; `storedDeflate` with > 65,535 bytes splits into ≤ 65,535-byte blocks |
| `session.test.ts` | node | every operation + validateStack after each; no-op edits push nothing; delete card disabled at 1; PBT #2 and #3 on all three fixtures |
| `dither.test.ts` | node | thresholds (black, white, 50% grey → Bayer checker), alpha → white, fitWithin |
| `imageImport.test.ts` | happy-dom | MIME and size rejection, injected decode → PNG data URL, no network APIs referenced |
| `overlay.test.ts` | happy-dom | outline SVG dasharray "4 4", 8 handles at the right points, hidden outlines |
| `inspector.test.ts` | happy-dom | controls per type, commit-on-change only, integer validation, no re-sync of focused control, duplicate-name warnings, parse status |
| `cardMenu.test.ts` | happy-dom | keyboard navigation, disabled delete, Card Info rename commit/cancel |
| `editor.test.ts` | happy-dom | inline stack with a background object: background object not selectable; card layer inert; click selects, no mouse messages dispatched; drag → one entry; Delete; Ctrl+Z/Ctrl+Shift+Z; exit flushes a pending script edit and browse runs it |
| `test/e2e/edit.spec.ts` | Playwright | REQ-9.3 |

`editor.test.ts` stubs `surface.getBoundingClientRect` and `stage.currentScale`, since happy-dom has no layout.

---

## Open questions (all fourteen accepted; 8, 12 and 13 with the changes noted)

1. **Messages while editing.** HyperCard sends `openCard`/`closeCard` when you change cards with an editing tool
   selected. Default: edit-mode navigation (card menu, undo/redo jumping to another card) and mode switches send no
   messages, so a card whose `openCard` redirects cannot pull you away while editing. Alternative: send them as
   HyperCard does.
2. **Background objects.** HyperCard has a separate "edit background" mode. Default: background objects are drawn
   but not selectable or editable, and new objects always go on the card; background editing is a later spec.
   Background *scripts* are editable from the inspector.
3. **Hidden objects in edit mode.** Default: drawn as a 1px dotted outline so they can be selected; still hidden in
   browse mode.
4. **Minimum size and on-card margin.** Default: `MIN_SIZE = 4` for width and height, and at least 4 px of every
   object stays on the card. Alternative: allow 0 × 0 (the schema permits it) and unbounded positions.
5. **`metadata.modified`.** Default: untouched by edit mode, which keeps undo byte-exact; `sharing` stamps it on
   save/export.
6. **History scope.** Default: one history per loaded stack, cleared on stack load, kept across mode switches,
   capped at 500; nudges coalesce; undo/redo keys only in edit mode and never inside text controls.
7. **Message box in edit mode.** Default: disabled. Alternative: keep it live, so `go next` from the box works while
   editing (it would send messages).
8. **Images.** Accepted with one change: `image/*` up to 5 MB; "Add image" fits the picture into **256 × 256** keeping
   aspect; dithering happens once at that size; later resizes scale the existing 1-bit bitmap without re-dithering;
   "Import…" in the inspector re-dithers at the current size. Raw `src` editing is allowed for asset ids, read-only
   for data URLs.
9. **Script status line.** Default: each script textarea shows the parse result (`No errors` / `Line N: …`) without
   blocking the commit. It is cheap (the parser exists) and catches errors before switching to Browse; `script-editor`
   supersedes it with inline errors.
10. **Card menu in browse mode.** Default: edit mode only. Browse-mode navigation stays script-driven.
11. **Duplicate names.** Default: allowed, with a warning in the inspector, as in HyperCard.
12. **Card/background/stack names.** Accepted with one change: card names are editable (inspector and Card Info); the
    **stack name is editable** in the inspector's Stack section as an undoable `renameStack` command, included in the
    undo/redo property tests; background names stay read-only.
13. **Drag ghost.** Accepted: no ghost; the real object moves live. `retro-ui.md` now says a 50% ghost is permitted
    but not required.
14. **Browse-mode files touched.** Default: small additions to `domHost.ts`, `stage.ts` and `runtime.ts` (listed in
    the module map). No change to `src/interp/` or `src/model/`, and no new dependencies.
