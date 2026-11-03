# edit-mode — Tasks

Execute in order. Each task is independently verifiable. Do not start a task until the previous one passes its
acceptance check. Every task ends with `npm run typecheck`, `npm run lint` and `npm test` green. No task modifies
`src/interp/` or `src/model/`, and no task adds a dependency.

---

## Task 1 — Geometry

**Steps:**
1. `src/ui/edit/geometry.ts`: `MIN_SIZE`, `Handle`, `clampRect`, `moveRect`, `resizeRect`, `nudgeRect`,
   `toLogicalDelta`, `handlePoints`, `hitHandle`, `hitTest` (REQ-2.2, REQ-3, design).
2. `geometry.test.ts`: clamp bounds at all four card edges; each of the eight handles; a handle cannot cross the
   opposite edge; half-open hit bounds; topmost object wins; hidden objects hit. PBT #1 part one (≥ 200 runs):
   results are integral and satisfy the clamp invariants for any start rect, scale in `(0, 8]`, deltas and handle.

**Acceptance:** tests green.

---

## Task 2 — Commands and history

**Steps:**
1. `commands.ts`: `Command` (including `renameStack`), `ObjectProp`, `ScriptOwner`, `applyCommand`, `invertCommand`,
   `describeCommand`, `CommandError` (design).
2. `history.ts`: `History` with push/coalesce/seal/undo/redo/cap.
3. Tests: apply then apply(invert) is identity under `serializeStack` for every command kind on the quiz fixture;
   stored clones are isolated from later mutation; type and index mismatches throw and change nothing; undo/redo
   order; push clears redo; coalescing keeps the first `before` and last `after`; `seal` stops coalescing; cap drops
   the oldest.

**Acceptance:** tests green.

---

## Task 3 — Naming, object factory, New Stack builder

**Steps:**
1. `naming.ts`: `uniqueId`, `uniqueObjectName`, `uniqueCardName`.
2. `objectFactory.ts`: `defaultRect`, `makeButton`, `makeField`, `makeImage` (REQ-4.2).
3. `newStack.ts`: `createNewStack(now, idGen)` (REQ-1.5).
4. Tests: names skip used numbers case-insensitively across card and background; card names across the stack;
   `uniqueId` retries on collision (injected generator); factory output passes `validateStack` when added to a
   fixture; `createNewStack` passes `validateStack`, has one background `Background 1`, one card `Card 1` on it,
   name `Untitled`, empty scripts, `created === modified === now.toISOString()`, `author === ''`, distinct ids.

**Acceptance:** tests green.

---

## Task 4 — EditSession and the property tests

**Steps:**
1. `session.ts`: `EditSession` and `SessionEvent` (design), with injectable `idGen` and `validate`.
2. `session.test.ts`:
   - every operation on an inline stack with a background object, calling `validateStack` after each;
   - no-op edits push nothing; delete card returns null at one card; new card uses the current `backgroundId` and is
     inserted after the current card; undo/redo report the affected card and selection;
   - nudge coalescing across ten Arrow presses gives one entry;
   - PBT #1 part two: geometry ops applied as commands keep the stack valid;
   - PBT #2: for each fixture, 1–30 random edits (move, resize, nudge, add button/field/image with a fixed tiny data
     URL, delete, property set, script set, new card, delete card, card rename, stack rename, plus non-undoable
     `showCard`/`select`),
     `validateStack` after every step, then undo all → `serializeStack` equals the original byte for byte (≥ 200
     runs);
   - PBT #3: then redo all → equals the post-edit serialization byte for byte (≥ 200 runs).

**Acceptance:** tests green; the three PBTs run ≥ 200 examples each.

---

## Task 5 — Dither, PNG, image import

**Steps:**
1. `dither.ts`: `fitWithin`, `ditherRgba` (reusing `BAYER_8`).
2. `png.ts`: `encodeBitsPng` and an exported `storedDeflate` that writes stored blocks of at most 65,535 bytes in a
   loop, with CRC-32 and Adler-32.
3. `imageImport.ts`: `importImage`, `ImportDeps`, `ImageImportError`; default decoder via `createImageBitmap` and a
   canvas.
4. Tests: black/white/grey/transparent thresholds; a 50% grey square dithers to exactly half black; `fitWithin`
   keeps aspect and enforces `MIN_SIZE`; PNG signature, IHDR (width, height, depth 1, colour type 0), CRCs and
   Adler-32 verified, and the decoded rows equal the input bits, including a full 512 × 342 bitmap;
   `storedDeflate` on 200,000 bytes yields four blocks (65,535 × 3 + 3,395), each length/`NLEN` pair correct and
   `BFINAL` only on the last; import rejects a non-image and a 6 MB file with
   plain-English messages; an injected decoder yields a `data:image/png;base64,` URL; `imageImport.ts` does not
   reference `fetch` or `XMLHttpRequest` (source check).

**Acceptance:** tests green.

---

## Task 6 — Stage, DomHost and runtime hooks

**Steps:**
1. `stage.ts`: `setEditing(on)` (`data-mode`, `inert` on current and future card layers, `tabIndex`),
   `setSelected(id | null)`.
2. `domHost.ts`: `showCard(index)` and `rerender()` — render without messages or transitions.
3. `runtime.ts`: `setMode(mode)` guard and an `onLoad` option.
4. Tests (extend the existing files): `showCard` and `rerender` send no messages and keep `data-card-*` correct;
   layers set while editing are inert; the runtime ignores gestures in edit mode even if `inert` were removed.
   Existing browse tests still pass unchanged.

**Acceptance:** tests green, including all existing browse-mode tests.

---

## Task 7 — Overlay and pointer

**Steps:**
1. `pointer.ts`: `clientToLogical`, `Drag`, `dragRect`.
2. `overlay.ts`: `EditOverlay` with hidden-object outlines, SVG dashed outline, eight handles.
3. Card-surface styles in `edit.css` (1-bit only; handles `#000`; dotted outline 1px `#000`; `--z-edit-overlay: 50`).
4. Tests: SVG `stroke-dasharray="4 4"` and `shape-rendering="crispEdges"`; handle elements at `handlePoints` minus 2px;
   hidden outlines for exactly the hidden card objects; `dragRect` at scales 0.75, 1 and 2 gives integer rects.

**Acceptance:** tests green; `edit.css` has no gradients, shadows, opacity or transitions on card-surface rules.

---

## Task 8 — Inspector

**Steps:**
1. `inspectorControls.ts`, `scriptSlot.ts`, `inspector.ts` (REQ-5, design).
2. Chrome styles for the inspector in `edit.css` (240px, chrome palette).
3. Tests: the right controls per object type and for the card view; commit only on `change` and only when the value
   differs; integer validation and revert message; clamped rect shown after commit; focused control not re-synced;
   duplicate-name warnings for objects and cards; script status shows `No errors` and a `Line N:` parse error;
   every control has a visible label.

**Acceptance:** tests green.

---

## Task 9 — Toolbar, card menu, mode toggle

**Steps:**
1. `modeToggle.ts`, `editToolbar.ts`, `cardMenu.ts` (REQ-1.1, REQ-4.1, REQ-6, REQ-7.3).
2. Tests: radiogroup semantics and disabled state; tool buttons fire their callbacks; undo/redo buttons reflect
   `canUndo`/`canRedo` and show `title`; menu keyboard navigation and Escape; Delete Card disabled with one card;
   Card Info rename OK commits, Cancel discards.

**Acceptance:** tests green.

---

## Task 10 — EditController and chrome wiring

**Steps:**
1. `editor.ts`: `EditController` (design), including the document keydown handling, pointer drag, double-click,
   image file input, flush-before-operation, and DEV-only validation logging.
2. `src/main.ts` and `src/ui/chrome.css`: mode toggle, New Stack button (disabled while busy; `Untitled` picker entry;
   `?stack=` removed), edit toolbar row, workspace row with the inspector; message box disabled in edit mode; any
   stack load resets the editor. `stackPicker.ts`: `showUntitled()` and its removal on fixture choice (with a test).
3. `editor.test.ts` (happy-dom, inline stack with a background object and a card script that would log mouse
   messages): enter edit → card layer inert; click selects and dispatches no message; background object not
   selectable; drag → one history entry with an integer rect; Arrow/Shift+Arrow nudge; Delete; Ctrl+Z / Ctrl+Shift+Z
   / Ctrl+Y; Backspace inside the inspector name input does not delete; a typed but uncommitted script is committed
   by switching to Browse, and the next click in browse runs it; stack load clears history.

**Acceptance:** tests green; `npm run build` succeeds.

---

## Task 11 — End-to-end and Playwright MCP

**Steps:**
1. `test/e2e/edit.spec.ts` per REQ-9.3 (add button → script `go next` → Browse → click → `Q1`; image import with a
   generated PNG and a check that no request left the dev server; New Stack → add button → script sets its label →
   Browse → click → label `Clicked`).
2. `npm run e2e` — both spec files pass.
3. Ask the user to start `npm run dev` (the agent's shell does not start servers). Then, through Playwright MCP:
   navigate to `/?stack=quiz`, switch to Edit, add a button, `browser_take_screenshot` of the selection and inspector
   to `.playwright-mcp/edit-mode-selection.png`, type the script, switch to Browse, click the button, confirm
   `data-card-name` is `Q1` with `browser_evaluate`, screenshot `.playwright-mcp/edit-mode-result.png`, and read
   `browser_console_messages`.
4. Add a `KIRO_USAGE.md` entry with the result, screenshot paths and console output.

**Acceptance:** `npm run e2e` green; the MCP run reaches `Q1` with no console errors.

---

## Task 12 — Final verification

**Steps:**
1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e` — all exit 0.
2. `git diff --stat -- src/interp src/model` is empty; `package.json` dependencies unchanged.
3. Every file in `src/ui/edit/` is under ~300 lines; imports respect REQ-10.
4. Grep `src/ui/edit` for `innerHTML`, `eval(`, `new Function`, `fetch(`, `XMLHttpRequest`, `linear-gradient`,
   `box-shadow`, `opacity`, `transition:` — none on card-surface content.
5. Run `necrotalk-reviewer` only if anything under `src/interp/` changed (it should not have).

**Acceptance:** all checks pass. The spec is done when this task is green.
