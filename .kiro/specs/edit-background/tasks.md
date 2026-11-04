# edit-background — Tasks

Implementation plan. Each task is self-contained and test-backed; later tasks build on earlier ones. The six
standard checks (`npm run typecheck`, `lint`, `test`, `build`, `server:build`, `e2e`) must be green before a task
is done, and the protected directories (`src/interp`, `src/model`, `fixtures`, `src/summon`, `server/`,
`src/share/`) and `package.json` dependencies must stay unchanged throughout.

References in brackets point at the design (§) and requirements (REQ-) sections.

---

- [ ] 1. Layer-aware commands (`commands.ts`) (REQ-5.1, REQ-5.2, design §3)
  - Add `export type CommandTarget = { kind: 'card'; cardId: string } | { kind: 'background'; backgroundId: string }`.
  - Replace `cardId` with `target: CommandTarget` on `setRect`, `setProp`, `addObject`, `removeObject`; change the
    object `ScriptOwner` variant to `{ kind: 'object'; target: CommandTarget; objectId: string }` (leave the
    `card`, `background`, `stack` owner variants as they are).
  - In `applyCommand`, resolve the container via a `containerObjects(stack, target)` helper (a missing background
    throws `CommandError`, changing nothing); keep the index and id checks for add/remove.
  - `describeCommand`: suffix `" (background)"` on a background-target object command so undo labels read
    `Undo Move button "Next" (background)`.
  - Update `commands.test.ts`: `everyKind` gains background-targeted `setRect`/`setProp`/`addObject`/`removeObject`
    and a background-object `setScript`; each applies/undoes/redoes; a `target` naming a missing background throws
    `CommandError` and changes nothing. Keep the existing card-target cases.
  - _Requirements: REQ-5.1, REQ-5.2_

- [ ] 2. The layer in the session (`session.ts`) (REQ-1.2, REQ-1.3, REQ-2, REQ-5.3, design §2)
  - Add `export type Layer = 'card' | 'background'`, a private `layer` (default `'card'`), `get activeLayer`,
    `setLayer(layer)` (seals history, clears selection, returns `{ render: true, select: null }`, does not bump
    `revision`) and `toggleLayer()`.
  - Add `activeCard`/`background` getters (via `backgroundOf`) and a `container()` returning the active objects plus
    the `CommandTarget`; route `selected`, `select`, `object`, `moveTo`, `nudge`, `setProp`, `addObject`,
    `addImage`, `deleteSelected` and the object `setScript` owner through it; expose `activeObjects()`.
  - Keep `layer` across `showCard` and `newCard` (and clear the selection in `newCard`); `deleteCard` keeps the
    layer and clears the selection, and `container()` recomputes the background from the new current card.
  - Rewrite `focusOn` so undo/redo never changes `layer`: show a card holding the affected object (current card if
    it holds it, else the first card whose id/background matches), and select the object only when its layer equals
    the current `layer`, else clear the selection.
  - Update `session.test.ts`: the layer switch drives `selected`/`addObject`/`deleteSelected`/`moveTo`/`setProp`;
    `activeObjects()` is card then background; layer is `'card'` fresh, survives `showCard`, toggle clears
    selection and leaves `revision` unchanged; `focusOn` after undo of a background command on the card layer
    selects nothing and keeps the layer; deleting a card on the background layer keeps the layer on, clears the
    selection, and `activeObjects()` resolves against the new current card's background.
  - _Requirements: REQ-1.2, REQ-1.3, REQ-2.1, REQ-2.3, REQ-5.3, REQ-5.4_

- [ ] 3. Overlay renders the active layer (`overlay.ts`) (REQ-2.2, design §4.2)
  - Change `render(card, selected)` to `render(objects: CardObject[], selected)`; draw the hidden-object dotted
    outlines from `objects`.
  - Update `overlay.test.ts` (if present) and every caller.
  - _Requirements: REQ-2.2_

- [ ] 4. Hit testing, Tab and the toggle plumbing (`editorInput.ts`, `editor.ts`) (REQ-1.1, REQ-2.1, REQ-4.2, design §4)
  - `editorInput`: replace `card().objects` with `ctrl.session!.activeObjects()` for `hitTest` (pointerdown and
    double-click) and Tab/Shift+Tab cycling; expose a drag-cancel the controller can call.
  - Add the `Ctrl+B` / `⌘B` branch to the keydown handler: return early (no `preventDefault`) when not in Edit mode
    or focus is in a text control; otherwise `preventDefault` and call `ctrl.toggleBackground()`.
  - `EditController`: add `toggleBackground()` (cancel a drag, flush, `session.toggleLayer()`, `refresh`, update
    the indicator); make `refresh()` call `overlay.render(session.activeObjects(), selected)` and `view()` build
    the object view from the active layer. The toggle is not routed through `op()`, so it never touches history or
    `onChange`.
  - _Requirements: REQ-1.1, REQ-2.1, REQ-4.2_

- [ ] 5. Card menu item and the indicator wiring (`cardMenu.ts`, `editToolbar.ts`, `editor.ts`, `stage.ts`) (REQ-1.1, REQ-3.2, design §5.1, §5.3)
  - `cardMenu`: add a `role="menuitemcheckbox"` "Edit Background" item with a CSS-drawn check, a right-aligned
    non-focusable `Ctrl+B` hint span, an `editBackground` action, and `setEditBackground(on)` toggling
    `aria-checked`.
  - `editToolbar`: forward the `editBackground` action and expose `cardMenu.setEditBackground`.
  - `CardStage`: add `setEditingBackground(on)` toggling `card-window-title--editing-bg`; confirm `setTitle` only
    writes `label.textContent` and never rebuilds `.card-window-title` (so the stripe class survives a rename).
  - `EditController.updateBackgroundIndicator()`: set the stage class and the menu checked state together; call it
    from `toggleBackground`, `enter` (off) and `exit` (off).
  - _Requirements: REQ-1.1, REQ-3.2_

- [ ] 6. The striped title bar and menu styling (`chrome.css`, `edit.css`) (REQ-3.1, design §5.3)
  - Add the `.card-window-title--editing-bg` 45° `repeating-linear-gradient` stripe (chrome only; keep the label's
    solid background so the name stays readable); style the menu check and the shortcut hint.
  - Confirm no rule scoped to `.card-surface` is added; the card-surface CSS guard stays green.
  - _Requirements: REQ-3.1_

- [ ] 7. Inspector follows the active layer, and happy-dom tests (`inspector.ts` if needed, `cardMenu.test.ts`, `editor.test.ts`/`inspector.test.ts`) (REQ-6.1, REQ-5.4, design §4.3, §6.3)
  - Confirm `Inspector.buildObject` renders a background object unchanged and that the controller's owners route to
    the background layer (no inspector logic change expected; verify).
  - `cardMenu.test.ts`: the menu renders a `menuitemcheckbox` "Edit Background" whose `aria-checked` follows
    `setEditBackground`; choosing it calls the action; the `Ctrl+B` hint text is present.
  - `editor.test.ts`/`inspector.test.ts` (inline stack with a background button): toggling the layer makes the
    background button selectable and shows its inspector heading; a card object is then not selectable; the stripe
    class toggles on the title bar; renaming the stack while the layer is on keeps the `--editing-bg` class; the
    duplicate-name warning still spans card + background with the background active (REQ-5.4).
  - _Requirements: REQ-6.1, REQ-5.4_

- [ ] 8. Property test across both layers (`session.test.ts` or the shared edit property file) (REQ-7.2, design §6.2)
  - Extend the edit-mode "undo restores / redo replays" property: each random edit first picks a layer via
    `setLayer`, then applies a random edit on it; undoing all restores `serializeStack` byte-for-byte, redoing all
    reproduces it, and `validateStack` holds after every step. ≥ 200 runs, deterministic injected id gen.
  - _Requirements: REQ-7.2_

- [ ] 9. End-to-end (`test/e2e/edit-background.spec.ts`) (REQ-7.3, design §6.4)
  - Open `/?stack=flashcards`, Edit, toggle Edit Background (assert the stripe and the menu check); New Button
    (lands on the background, selected); Card-menu Next → the button is on the next card; move it; back → moved;
    undo → restored; toggle off → the card's own Next is selectable and the new background button is not. Create the
    background object in the test (fixtures are empty-backgrounded and protected).
  - Confirm `edit.spec.ts` and `browse.spec.ts` still pass.
  - _Requirements: REQ-7.3_

- [ ] 10. Full verification and the Playwright MCP run (REQ-7.4, design §6.5)
  - Run the six checks; confirm the protected directories and `package.json` deps are unchanged, the card-surface
    guard and the `src/share` boundary stay green, and no file is over ~300 lines.
  - One MCP run against the dev server (already running on http://localhost:5173): flashcards → Edit → toggle Edit
    Background → New Button; screenshot the striped title bar with the selected background button to
    `docs/screenshots/edit-background.png`; read the console; finish by clearing `localStorage` (the sample fork
    left a library copy).
  - Write the run entry in `KIRO_USAGE.md`.
  - _Requirements: REQ-7.4, REQ-8_
```
