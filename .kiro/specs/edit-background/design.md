# edit-background — Design

## 1. Overview

Edit-background adds one piece of editor session state — a `layer` that is `'card'` or `'background'` — and makes
every place that today reads "the current card's objects" read "the active layer's objects" instead. The data model
is unchanged: a background object is already a `CardObject` living in `background.objects`, and the message path
already visits backgrounds in Browse. The work is entirely in `src/ui/edit/` plus a one-line title-bar class toggle
and a `Ctrl+B` shortcut in `src/main.ts`.

The active layer threads through five seams that all exist today:

1. **The object container.** `EditSession` has a private `card` getter and a `object(id)` lookup that both target
   `cards[cardIndex]`. These become layer-aware: on the background layer they target `backgroundOf(stack, card)`.
2. **Commands.** The object-targeting commands (`setRect`, `setProp`, `addObject`, `removeObject`) key their
   container by `cardId`. They gain a layer tag so `applyCommand` resolves the object on a background too, and undo
   restores it there. Script owners for a background object name the background.
3. **Hit testing and the overlay.** `editorInput`'s `card().objects` and `EditController.refresh`'s
   `overlay.render(card, selected)` switch to the active layer's objects; the inactive layer stays drawn by the
   normal card render, just not hit.
4. **The inspector view.** `EditController.view()` builds its `{kind:'object'}` view from the active layer's
   selected object and gives `setProp`/`setScript` a layer-aware owner.
5. **The indicator.** The Card menu gains a checkable item; `main.ts`/`stage` toggles a class on the title bar.

This satisfies REQ-1–REQ-8. It supersedes nothing; it lifts `edit-mode` REQ-2.1 from "card objects only" to
"active-layer objects".

### Module map

| File | Change |
|---|---|
| `src/ui/edit/commands.ts` | add a `Layer`/container tag to object commands; `applyCommand` resolves on a card or background; object `ScriptOwner` can name a background |
| `src/ui/edit/session.ts` | `layer` state, layer-aware `activeObjects`/`object`/`container`, `setLayer`, layer-tagged commands, `focusOn` that never switches layer |
| `src/ui/edit/overlay.ts` | `render` takes the active-layer objects (a list) rather than reaching into `card.objects` |
| `src/ui/edit/editorInput.ts` | hit testing, Tab cycling and the drag target read the active layer; `Ctrl+B`; cancel a drag before a toggle |
| `src/ui/edit/editor.ts` | `view()` and `refresh()` use the active layer; wire the toggle; keep the toggle out of history |
| `src/ui/edit/inspector.ts` | unchanged logic; it already renders any `CardObject`; owners come from the controller |
| `src/ui/edit/cardMenu.ts` | a checkable "Edit Background" item with a `Ctrl+B` hint and a CSS check |
| `src/ui/edit/editToolbar.ts` | pass the toggle action and checked state to the card menu |
| `src/ui/edit/edit.css`, `src/ui/chrome.css` | the diagonal title stripe, the menu check and the shortcut hint |
| `src/main.ts` | toggle the title-bar stripe class on mode/layer change |

No change to `src/interp/`, `src/model/`, `fixtures/`, `src/summon/`, `server/`, `src/share/`, or deps.

---

## 2. The layer, in the session (`session.ts`) — REQ-1, REQ-2

### 2.1 State

```ts
export type Layer = 'card' | 'background';
```

`EditSession` gains `private layer: Layer = 'card'` with:

- `get activeLayer(): Layer`
- `setLayer(layer: Layer): SessionEvent` — seals history, clears the selection, sets the layer, returns
  `{ render: true, select: null }`. Not a command; `revision` does not change (REQ-1.3 crit 2).
- `toggleLayer(): SessionEvent` — `setLayer(this.layer === 'card' ? 'background' : 'card')`.

The layer is a session field, so it is off (`'card'`) for a fresh session and is discarded when the session is
replaced on load (REQ-1.2 crit 2) or on leaving Edit (the controller resets to card layer; REQ-1.2 crit 3). It is
untouched by `showCard`, so it persists across navigation (REQ-1.2 crit 4). `newCard` sets `cardIndex` but leaves
`layer` alone and clears the selection (REQ-1.2 crit 5).

### 2.2 Active container and objects

A private helper centralises the layer lookup:

```ts
private get activeCard(): Card { return this.state.stack.cards[this.state.cardIndex]; }
private get background(): Background { return backgroundOf(this.state.stack, this.activeCard); }

/** The container whose objects the editor currently acts on, with its command tag. */
private container(): { objects: CardObject[]; target: CommandTarget } {
  return this.layer === 'background'
    ? { objects: this.background.objects, target: { kind: 'background', backgroundId: this.background.id } }
    : { objects: this.activeCard.objects, target: { kind: 'card', cardId: this.activeCard.id } };
}
public activeObjects(): CardObject[] { return this.container().objects; }
```

Every method that read `this.card.objects` or built a `cardId`-keyed command now goes through `container()`:

- `selected()` — find in `activeObjects()`.
- `select(id)` — membership check against `activeObjects()`.
- `object(id)` — find in `activeObjects()`; `CommandError('The object is not on this layer')` if absent.
- `moveTo`, `nudge`, `setProp` — build the command with `target` instead of `cardId`.
- `addObject`/`addImage` — `index: activeObjects().length`, `target`; `uniqueObjectName` still takes the card index
  so the name is unique across the card and its background (REQ-2.3 crit 4; unchanged).
- `deleteSelected` — `index` within `activeObjects()`, `target`.
- `setScript` object owner — `{ kind: 'object', target, objectId }` (see §3.2).

`showCard`, `newCard`, `deleteCard`, `renameCard`, `renameStack` are card/stack-level and unchanged except that
`showCard`/`newCard` keep `layer`.

**Deleting a card while on the background layer.** `deleteCard` keeps `layer` and clears the selection (as it does
today). The new current card may use a *different* background, but `container()` recomputes `background` from the
current card on every access, so the editor simply edits the new card's background — the layer stays on and no
stale background is referenced. Covered in `session.test.ts` (§6.1).

### 2.3 Focus after undo/redo never switches layer (REQ-5.3)

`focusOn(cmd)` today sets `cardIndex` and selects the object. It changes so that:

- it shows a card that contains the affected object (for a background target, any card on that background — the
  current card if it qualifies, else the first card with that `backgroundId`);
- it selects the object only when the command's layer equals the current `layer`; otherwise it clears the
  selection. It never assigns `layer`.

So undoing a background edit while on the card layer shows the change (the background is drawn) but selects nothing
and leaves the toggle off (OQ1 resolved: no layer flip).

---

## 3. Layer-aware commands (`commands.ts`) — REQ-5

### 3.1 A container tag on object commands

```ts
export type CommandTarget =
  | { kind: 'card'; cardId: string }
  | { kind: 'background'; backgroundId: string };
```

The four object commands carry `target: CommandTarget` in place of `cardId`:

```ts
| { kind: 'setRect'; target: CommandTarget; objectId: string; before: Rect; after: Rect; reason: RectReason }
| { kind: 'setProp'; target: CommandTarget; objectId: string; prop: ObjectProp; before: …; after: … }
| { kind: 'addObject'; target: CommandTarget; index: number; object: CardObject }
| { kind: 'removeObject'; target: CommandTarget; index: number; object: CardObject }
```

`applyCommand` resolves the container from `target`:

```ts
function containerObjects(stack: Stack, t: CommandTarget): CardObject[] {
  if (t.kind === 'card') return cardById(stack, t.cardId).objects;
  const bg = stack.backgrounds.find(b => b.id === t.backgroundId);
  if (!bg) throw new CommandError('The background no longer exists');
  return bg.objects;
}
```

`setRect`/`setProp` find `objectId` in `containerObjects`; `addObject`/`removeObject` splice there, keeping the
index and id checks (REQ-5.1 crit 3). A missing layer throws `CommandError`, changing nothing.

`describeCommand` names the object as today; for a background target it can suffix "(background)" so the undo label
reads `Undo Move button "Next" (background)` (minor; design detail, not required).

**Migration cost:** `cardId` → `target` is a breaking rename on the command type. The only writers are
`EditSession` (updated in §2.2) and `commands.test.ts`/`session.test.ts` (updated). `applyCommand`,
`describeCommand` and `history.ts` are the only readers. `history.ts` stores commands opaquely, so it needs no
change.

### 3.2 Script owners

`ScriptOwner` already has `{ kind: 'background'; backgroundId }` for the background's own script. For a background
*object's* script, the object owner gains a container tag mirroring §3.1:

```ts
export type ScriptOwner =
  | { kind: 'object'; target: CommandTarget; objectId: string }
  | { kind: 'card'; cardId: string }
  | { kind: 'background'; backgroundId: string }   // the background's own script (unchanged)
  | { kind: 'stack' };
```

`session.scriptOf` and `applyCommand`'s `setScript` resolve an object owner through `containerObjects(stack,
owner.target)`. The inspector's Background-section script still uses `{ kind: 'background', backgroundId }`
unchanged (REQ-5.2 crit 2).

### 3.3 Exactness across layers (REQ-5.1 crit 4)

`applyCommand` and its inverse already round-trip; since the only change is where the object is found, the
byte-exact undo/redo guarantee (edit-mode REQ-7.4) holds for background targets too. The property test (§6) drives
it on both layers.

---

## 4. Hit testing, overlay, inspector (`editorInput.ts`, `editor.ts`, `overlay.ts`) — REQ-2, REQ-6

### 4.1 Active-layer hit testing

`editorInput` replaces its `card()` helper with `active = () => ctrl.session!.activeObjects()`:

- `hitTest(active(), p.x, p.y)` on `pointerdown` and double-click;
- Tab / Shift+Tab cycles `active()`.

The inactive layer's elements are in the card DOM but the overlay captures all pointer input (edit-mode REQ-1.2),
and hit testing only consults `active()`, so an inactive-layer object is never selected (REQ-2.1 crit 4): a
pointer there misses and clears the selection.

### 4.2 Overlay renders the active layer

`EditOverlay.render` currently takes `(card: Card, selected)` and reads `card.objects`. It changes to
`render(objects: CardObject[], selected: CardObject | null)` and draws the hidden-object outlines from `objects`.
`EditController.refresh` calls `this.overlay.render(this.session.activeObjects(), selected)`. So on the background
layer, hidden background objects get the dotted outline and hidden card objects do not (REQ-2.2).

### 4.3 Inspector view

`EditController.view()` builds the object view from the active layer:

```ts
const obj = s.selected();            // already from activeObjects()
return obj
  ? { kind: 'object', stack: s.stack, cardIndex: s.cardIndex, obj }
  : { kind: 'card', stack: s.stack, cardIndex: s.cardIndex };
```

`Inspector.buildObject` renders any `CardObject` unchanged (REQ-6.1). The controller supplies layer-aware owners:
its inspector `setProp`/`setScript`/`setRect` callbacks call `s.setProp(id, …)` etc., which build the command from
`container()` (§2.2), so a background object's inspector commit is a background-layer history entry (REQ-6.1
crit 3). The "nothing selected" view (Card/Background/Stack) is unchanged (REQ-6.1 crit 2), and Card Info is
untouched (REQ-6.2).

### 4.4 The toggle and drag cancel

`EditController` gains `toggleBackground()`:

```ts
toggleBackground(): void {
  if (this.mode !== 'edit' || !this.session) return;
  this.cancelDragIfAny();          // editorInput exposes a cancel; a drag restores its start rect (REQ-1.3 crit 4)
  this.flush();                    // commit pending inspector input
  const ev = this.session.toggleLayer();
  this.refresh(ev);
  this.updateBackgroundIndicator();
}
```

`refresh` already clears/sets `data-selected-id` and redraws the overlay. `updateBackgroundIndicator()` toggles the
title-bar class (§5) and the card menu's checked state. The toggle is not routed through `op()`, so it never
touches history or fires `onChange` (REQ-1.3 crit 2).

---

## 5. The indicator and the shortcut — REQ-1.1, REQ-3

### 5.1 Card menu item

`createCardMenu` gains an `editBackground` action and a `setEditBackground(on: boolean)` method. The item is a
`role="menuitemcheckbox"`:

- `aria-checked` tracks the state;
- a CSS-drawn check (an `::before` tick, like the existing CSS caret) shows when checked (OQ3);
- a right-aligned, non-focusable `<span class="card-menu-hint">Ctrl+B</span>` shows the shortcut as plain text
  (OQ4).

`editToolbar` forwards `editBackground` and exposes `cardMenu.setEditBackground`.

### 5.2 Ctrl+B

`bindEditorInput` adds, to its existing keydown handler (which already ignores text controls, edit-mode REQ-7.3):

```ts
if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
  if (ctrl.mode !== 'edit' || inEditableControl(e.target)) return;  // let the browser keep Ctrl+B
  e.preventDefault();                                               // only when we consume it (REQ-1.1 crit 5)
  ctrl.toggleBackground();
}
```

`bindEditorInput` runs only in Edit mode (bound on enter, unbound on exit), so in Browse there is no handler and
the browser's `Ctrl+B` is untouched.

### 5.3 The striped title bar

The title bar already draws horizontal stripes with a `repeating-linear-gradient` (`chrome.css`, chrome-only). A
modifier class adds a 45° variant:

```css
.card-window-title--editing-bg::before,
.card-window-title--editing-bg::after {
  background: repeating-linear-gradient(45deg, #000 0, #000 1px, #fff 1px, #fff 3px);
}
```

`CardStage` gets `setEditingBackground(on: boolean)` toggling `card-window-title--editing-bg`, called from
`EditController.updateBackgroundIndicator()`. The label keeps its solid background so the name stays readable
(REQ-3.1 crit 3). On leaving Edit, `exit()` calls `setEditingBackground(false)` (REQ-3.1 crit 2). No
`.card-surface` rule changes (REQ-3.1 crit 4). `main.ts` needs no new logic beyond already owning the stage.

**The stripe must survive a title change.** `stage.setTitle(name)` runs on every load and on every stack rename
(the inspector updates the title live). It must set only the label's text and must not rebuild or replace the
`.card-window-title` element, or it would drop the `--editing-bg` modifier mid-session. `setTitle` already writes
`label.textContent` in place, so this holds; the editor happy-dom test asserts it (rename the stack while the
layer is on and confirm the stripe class is still present, §6.3).

---

## 6. Testing — REQ-7

### 6.1 Unit (Vitest, node)

- `session.test.ts`: `setLayer`/`toggleLayer` switches which objects `selected`/`addObject`/`deleteSelected`/
  `moveTo`/`setProp` act on; `activeObjects()` is the card's then the background's; the layer is `'card'` for a
  fresh session, survives `showCard`, and the toggle clears the selection and leaves `revision` unchanged;
  `focusOn` after undo of a background command while on the card layer selects nothing and does not change the
  layer; deleting a card while on the background layer keeps the layer on, clears the selection, and
  `activeObjects()` then resolves against the new current card's background.
- `commands.test.ts`: `everyKind` gains background-targeted `setRect`/`setProp`/`addObject`/`removeObject` and a
  background-object `setScript`; each applies, undoes and redoes; a `target` naming a missing background throws
  `CommandError` and changes nothing.
- `naming` unchanged; a test confirms the duplicate-name warning still spans card + background with the background
  active (REQ-5.4).

### 6.2 Property (fast-check ≥ 200 runs)

Extend the edit-mode "undo restores / redo replays" property: each random edit first picks a layer
(`'card' | 'background'`) via `setLayer`, then applies a random edit on it. Undoing all restores `serializeStack`
byte-for-byte; redoing all reproduces it; `validateStack` holds after every step. Deterministic injected id gen, as
edit-mode.

### 6.3 happy-dom

- `cardMenu.test.ts`: the menu renders a `menuitemcheckbox` "Edit Background" whose `aria-checked` follows
  `setEditBackground`; choosing it calls the action; the `Ctrl+B` hint text is present.
- `inspector.test.ts` / `editor.test.ts`: with an inline stack whose background has a button, toggling the layer
  makes the background button selectable and shows its inspector heading; a card object is then not selectable; the
  stripe class toggles on the title bar; renaming the stack (via the inspector) while the layer is on keeps the
  `--editing-bg` stripe class on the title bar (`setTitle` must not drop it).

### 6.4 e2e (`test/e2e/edit-background.spec.ts`) — REQ-7.3

Open `/?stack=flashcards`, Edit, toggle Edit Background, New Button (lands on the background, selected), Card-menu
Next → the button is on the next card, move it, back → moved, undo → restored, toggle off → the card's own Next is
selectable and the new background button is not. The fixtures are untouched; the button is created in the test.

### 6.5 MCP — REQ-7.4

One run: flashcards → Edit → Edit Background → New Button → screenshot the striped title bar with the selected
background button to `docs/screenshots/edit-background.png`; read the console; clear `localStorage` at the end
(editing the sample forked a library copy).

### 6.6 Regression

`edit.spec.ts` and the edit-mode unit/property tests keep passing: with the layer defaulting to `'card'`, every
existing path is unchanged. The `cardId`→`target` command rename is covered by updating the two edit-mode test
files that build commands directly.

---

## 7. Risks and notes

1. **The `cardId` → `target` command rename** touches `commands.ts`, `session.ts` and two edit-mode test files.
   It is mechanical, but it is the one change that reaches existing edit-mode code; the property test and the full
   edit-mode suite guard it. `history.ts` stores commands opaquely and needs no change.
2. **`backgroundOf`** (in `src/ui/browse/objectOps.js`) is already imported by the editor and the inspector, so the
   session can use it without a new dependency.
3. **Which card to show when undoing a background edit** (§2.3): the current card if it uses that background, else
   the first card with that `backgroundId`. A background with no card is not reachable in the editor, so this
   always finds one.
4. **File sizes:** `session.ts` and `commands.ts` grow modestly; both are well under 300 lines today and stay
   under. The CSS additions are a few rules. No split expected.
5. **No interpreter or model change:** background objects already run in Browse, so there is nothing to verify
   there beyond the existing browse e2e staying green.
