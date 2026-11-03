# browse-mode — Design

## Module map

```
src/
├── main.ts                      # Boot: build chrome, read ?stack=, start BrowseApp
└── ui/
    ├── variables.css            # :root palette, card size, font-stack variables, z-index scale
    └── browse/
        ├── browse.css           # Card surface, objects, dialogs, chrome, message box
        ├── scale.ts             # computeScale(W, H) — pure
        ├── stage.ts             # CardStage: viewport + scaled surface, ResizeObserver
        ├── objectOps.ts         # findObject, getProp, setProp on the working copy — pure
        ├── messageContext.ts    # buildCardContext / buildObjectContext — pure
        ├── renderButton.ts      # createButtonEl(obj), updateButtonEl(el, obj)
        ├── renderField.ts       # createFieldEl(obj, onInput), updateFieldEl
        ├── scrollBar.ts         # 1-bit DOM scroll bar for scrolling fields
        ├── renderImage.ts       # createImageEl(obj)
        ├── renderCard.ts        # renderCard(stack, index) → card layer element + id→element map
        ├── ditherMask.ts        # BAYER_8, ditherMaskUrl(frame) — pure (SVG data URLs)
        ├── transitions.ts       # TRANSITION_DURATION_MS, TRANSITION_FRAMES, frameStyle(), runTransition()
        ├── dialogs.ts           # showAnswer(), showAsk() — modal 1-bit dialogs
        ├── domHost.ts           # DomHost implements HostInterface
        ├── runtime.ts           # BrowseRuntime: busy flag, send(), gestures, error status
        ├── messageBox.ts        # wrapStatement (interim global declarations), remapLine, runMessageBoxLine
        ├── stackPicker.ts       # <select> of fixtures, ?stack= handling
        └── *.test.ts            # co-located tests
test/e2e/browse.spec.ts          # Playwright click-through
playwright.config.ts             # webServer = vite dev, chromium only
```

Every file stays under ~300 lines. No barrel `index.ts`.

### Dependency graph (runtime imports)

```
main.ts → stackPicker, runtime, stage
runtime → domHost, messageContext, messageBox, interp/messageQueue (dispatchMessage)
domHost → renderCard, objectOps, transitions, dialogs, interp/evaluator (types only)
messageBox → interp/parser (parse), interp/evaluator (evaluate), interp/errors
renderCard → renderButton, renderField, renderImage
transitions → ditherMask
objectOps, messageContext, scale, ditherMask → model/types (types only)
```

`DomHost` does not import `runtime.ts`; the runtime injects a `sendCardMessage` callback (below), which
breaks the cycle between "navigation needs messages" and "messages need the host".

---

## State

```ts
// runtime.ts
interface BrowseState {
  stack: Stack;                    // working copy (structuredClone of the fixture)
  cardIndex: number;               // 0-based
  globals: Map<string, string>;    // shared by all dispatches and the message box
  pendingEffect: VisualEffect | null;
  busy: boolean;
  navDepth: number;                // nested goToCard depth (REQ-4.2 limit 16)
}
```

One `BrowseState` per loaded stack. Loading a new fixture builds a fresh state and a fresh `DomHost`;
nothing from the previous stack survives (REQ-3.2). `DomHost` holds a reference to the state and mutates
it; `runtime.ts` owns its lifecycle.

---

## scale.ts

```ts
export const CARD_WIDTH = 512;
export const CARD_HEIGHT = 342;

export function computeScale(availW: number, availH: number): number {
  const raw = Math.min(availW / CARD_WIDTH, availH / CARD_HEIGHT);
  if (!Number.isFinite(raw) || raw <= 0) return 1;   // degenerate layout: show at 1x
  return raw >= 1 ? Math.floor(raw) : raw;
}
```

`stage.ts` observes the viewport element with `ResizeObserver`, sets
`surface.style.transform = scale(s)` and sizes a wrapper to `512·s × 342·s` so layout flows around the
transformed surface. `transform-origin: 0 0`.

The dialogs and transition layers live inside the surface, so they scale with it and their 1px lines
stay on the logical grid.

---

## objectOps.ts (pure, no DOM)

```ts
export type ObjectHit =
  | { kind: 'object'; obj: CardObject; layer: 'card' | 'background' }
  | { kind: 'card'; card: Card; index: number }
  | { kind: 'background'; background: Background }
  | { kind: 'stack'; stack: Stack };

export function findObject(stack: Stack, cardIndex: number, ref: ResolvedObjectRef): ObjectHit;
export function getProp(hit: ObjectHit, property: string): string;
export function setProp(hit: ObjectHit, property: string, value: string): CardObject | null;
// returns the mutated object so the caller can re-render it; null when nothing visible changed
```

Lookup follows REQ-4.1: card objects bottom-to-top, then background objects; `type` exact, `name`
case-insensitive; first match wins. Errors are plain `Error`s with the REQ messages
(`No field named "Score"`, `Unknown property "color"`, `Expected true or false but got "maybe"`).

Keeping this pure lets the property round-trip PBT (REQ-8.2 #2) and all lookup edge cases run in the
Node environment with no DOM.

Known limitation: `ResolvedObjectRef` carries only a name, so `hide me` on a button whose name is shared
with an earlier object on the same card hides the earlier one. Fixtures do not hit this (see open
question 2).

---

## messageContext.ts (pure)

```ts
export function buildCardContext(stack: Stack, cardIndex: number): MessageContext;
export function buildObjectContext(stack: Stack, cardIndex: number, objectId: string): MessageContext;
```

Fills `MessageContext` exactly per REQ-5.1. `buildObjectContext` searches the card's objects, then its
background's objects, by id (DOM elements carry `data-object-id`, so the id is unambiguous here even
though `me` is name-based).

---

## Rendering

### renderCard.ts

```ts
export interface RenderedCard {
  layer: HTMLDivElement;                       // .card-layer, 512 × 342, absolutely positioned
  elements: Map<string, HTMLElement>;          // object id → element
}
export function renderCard(stack: Stack, index: number, hooks: RenderHooks): RenderedCard;
```

The layer contains a `.background-layer` and a `.card-objects` layer, in that order. `RenderHooks`
supplies `onFieldInput(objectId, text)` so unlocked field edits write to the working copy.

Re-rendering is per object: `DomHost.setProp` gets the mutated object back from `objectOps.setProp` and
calls the matching `update*El(el, obj)`. A full card re-render happens only on navigation. Background
objects appear on every card, so their elements are re-created per card from the (shared) model; this
is how REQ-3.3 falls out with no extra code.

All text is set via `textContent` or `.value`; `innerHTML` is never used with stack content.

### renderButton.ts

`<button type="button" class="card-object button button-<style>">`. `aria-label` only when the label is
empty (falls back to the name). Hilite is a class toggle driven by `runtime.ts` gesture handling.

CSS (in `browse.css`), sketch:

```css
.card-surface .button { all: unset; box-sizing: border-box; position: absolute;
  display: flex; align-items: center; justify-content: center; background: #fff; color: #000; }
.card-surface .button-rect      { border: 1px solid #000; }
.card-surface .button-roundrect { border: 2px solid #000; border-radius: 8px; }
.card-surface .button-transparent { border: 0; background: transparent; }
.card-surface .button--hilite   { background: #000; color: #fff; }
.card-surface .button:focus-visible { outline: 1px dotted #000; outline-offset: -3px; }
```

The 1px bevel is drawn with a nested `::after` 1px inset border pair (white top/left, black
bottom/right), not `box-shadow` — retro-ui forbids shadows on card objects.

### renderField.ts / scrollBar.ts

Every field is a positioned `<div class="card-object field field-<style>">` (the element carrying
`data-object-id` and the rect). Inside it:

- Locked (`field--locked` on the outer div): a `<div class="field-text" role="textbox"
  aria-readonly="true" aria-multiline="true" aria-label="<name>">` (`white-space: pre-wrap`,
  `overflow: hidden`, or `overflow-y: auto` with the native bar hidden for `scrolling`).
- Unlocked: a `<textarea class="field-text" aria-label="<name>" spellcheck="false">` with
  `all: unset` plus explicit `white-space: pre-wrap`. A textarea cannot have children, so the outer
  div is what lets a scrolling unlocked field carry its scroll bar.
- `scrolling`: the content area is `width - 16px`; `scrollBar.ts` appends a 16px column with two
  16 × 16 arrow boxes (inline SVG arrows) and a track with a 16px-tall thumb whose `top` is
  `scrollTop / (scrollHeight - clientHeight) × (trackHeight - 16)`. It listens to the content's `scroll`
  event and to clicks on arrows/track. Native scroll bar hidden with `scrollbar-width: none` and
  `::-webkit-scrollbar { display: none }`.

### renderImage.ts

`data:image/` sources → `<img>`; anything else → placeholder `<div role="img">` with a 50% checker
dither from an inline SVG data URL in `browse.css` (two black 1 × 1 rects in a 2 × 2 tile).

### Fonts

`variables.css` defines `--font-ui`, `--font-field`, `--font-script`. Bundled open-licensed bitmap
fonts are delivered by `retro-skin`; until then `--font-ui` and `--font-field` fall back to
`sans-serif` and `--font-script` to `monospace`. Font sizes are fixed px.

### Hidden objects

`.card-surface .card-object[hidden] { display: none !important; }` — required because the object
rules (`all: unset; display: flex` etc.) outrank the UA `[hidden]` rule.

---

## Transitions

### ditherMask.ts (pure)

```ts
export const BAYER_8: readonly number[];          // 64 thresholds 0..63, standard 8×8 ordered dither
export function maskCoverage(frame: number, frames: number): number;   // cells revealed: round(64·frame/frames)
export function ditherMaskUrl(frame: number, frames: number): string;  // data:image/svg+xml,... 8×8 tile
```

The SVG tile contains one `<rect width="1" height="1">` per revealed cell (cells with
`BAYER_8[i] < coverage`), `shape-rendering="crispEdges"`. White (opaque) cells reveal the new card. All
11 URLs are computed once at module load. Using SVG strings rather than a canvas keeps the module pure
and testable in Node, and nothing is ever read back from the card DOM.

### transitions.ts

```ts
export const TRANSITION_DURATION_MS = 333;
export const TRANSITION_FRAMES = 11;

export interface FrameStyle { oldCard: Partial<CSSStyleDeclaration>; newCard: Partial<CSSStyleDeclaration>; }
export function frameStyle(effect: VisualEffect, frame: number): FrameStyle;   // pure
export function runTransition(effect: VisualEffect, oldLayer: HTMLElement, newLayer: HTMLElement): Promise<void>;
```

`frameStyle` (for frame `k` in `0..11`, `t = k / 11`):

| Effect | New card | Old card |
|---|---|---|
| `dissolve` | `maskImage: url(ditherMaskUrl(k))`, `maskSize: 8px 8px`, `maskRepeat: repeat` | unchanged |
| `wipe left` | `clipPath: inset(0 0 0 ${round(512·(1−t))}px)` | unchanged |
| `wipe right` | `clipPath: inset(0 ${round(512·(1−t))}px 0 0)` | unchanged |
| `scroll up` | `transform: translateY(${round(342·(1−t))}px)` | `transform: translateY(${−round(342·t)}px)` |

`runTransition` stacks the new layer above the old (`inert`) layer, applies frame 0, then on each
`requestAnimationFrame` computes `k = min(11, floor(elapsed / (333 / 11)))` and applies the frame
only when `k` changes. Frame 0 is shown at 0 ms and frame 11 lands at 333 ms (12 visible states). At
`k = 11` it removes the old layer, clears the inline mask/clip/transform on
the new layer, and resolves. Reduced motion (`matchMedia('(prefers-reduced-motion: reduce)')`) jumps
straight to the final state.

Under happy-dom, `requestAnimationFrame` exists but there is no layout; tests use `frameStyle` for
correctness and a fake clock (`vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance'] })`)
only to assert `runTransition` resolves and cleans up.

---

## Dialogs (dialogs.ts)

```ts
export function showAnswer(surface: HTMLElement, prompt: string, buttons: string[]): Promise<string>;
export function showAsk(surface: HTMLElement, prompt: string, defaultValue: string): Promise<string>;
```

- A `.dialog-backdrop` (transparent, covers the surface, swallows pointer events) holding a
  `.dialog` box: `width: 360px`, centred, `border: 1px solid #000` + an inner 1px white gap + 2px black
  frame (drawn with nested elements), `z-index` within the modal band (≤ 1000).
- Buttons reuse `.button .button-roundrect`; the default button gets `.button--default` (3px black ring
  via an outer wrapper with `border-radius: 11px`). No shadows.
- Not using `<dialog>.showModal()`: the top layer would escape the scaled surface and break the
  logical pixel grid. Focus trapping is done manually (Tab / Shift+Tab cycle among the dialog's
  focusables); the card layer and message box get `inert` while a dialog is open.
- Keys: Enter → default; Escape → `ask` cancel, ignored for `answer`.
- On close the backdrop is removed, `inert` is cleared, focus is restored, and the promise resolves.

---

## DomHost (domHost.ts)

```ts
export type SendCardMessage = (message: 'openCard' | 'closeCard') => Promise<void>;

export class DomHost implements HostInterface {
  constructor(state: BrowseState, stage: CardStage, sendCardMessage: SendCardMessage);
  mountInitialCard(): void;     // renders card 0 without messages; runtime then sends openStack/openCard
  // HostInterface members, exactly
}
```

### goToCard(index)

```
if index out of range            → throw Error("Card index <index+1> is out of range")
effect = state.pendingEffect; state.pendingEffect = null
if index === state.cardIndex     → return
if ++state.navDepth > 16         → navDepth--, throw Error("Too many nested go commands")
try:
  await sendCardMessage('closeCard')          // me = current card
  next = renderCard(state.stack, index, hooks)
  if effect: await runTransition(effect, current.layer, next.layer)
  else: replace current.layer with next.layer
  current = next; state.cardIndex = index; update data-card-index / data-card-name
  await sendCardMessage('openCard')           // me = new card
finally: state.navDepth--
```

`closeCard` runs while the old card is still current, so its handlers see the old card's objects, as in
HyperCard. If `closeCard` itself navigates, the outer call still proceeds to its own target afterwards —
the last `go` wins, matching HyperCard's sequential behaviour.

### Other members

- `setVisualEffect(e)`: `state.pendingEffect = e`; resolves immediately.
- `answer` / `ask`: delegate to `dialogs.ts` with the stage surface.
- `showObject` / `hideObject` / `getProperty` / `setProperty` / `getFieldText` / `setFieldText`:
  `findObject` → `getProp` / `setProp` → `update*El` for the element in `current.elements` (if the object is
  on screen).
- `beep`: lazily creates one `AudioContext`; `OscillatorNode` type `square`, 880 Hz, `GainNode` 0.1,
  stop after 100 ms. Wrapped in `try/catch`; failures are ignored.
- `getDate` / `getTime`: `toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })`
  and `toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })`.
- `random(n)`: `Math.floor(Math.random() * n) + 1` (not security-sensitive).

---

## Runtime (runtime.ts)

```ts
export class BrowseRuntime {
  constructor(stage: CardStage, status: StatusLine);
  load(stack: Stack): Promise<void>;           // fresh state + DomHost; render; openStack; openCard
  runMessageBox(line: string): Promise<void>;
  readonly isBusy: boolean;
}
```

### Top-level dispatch

```ts
private async top(label: string, work: () => Promise<void>): Promise<void> {
  if (this.state.busy) return;                       // REQ-5.4
  this.setBusy(true); this.status.clear();
  try { await work(); }
  catch (e) { console.error(e); this.status.show(`${label}: ${messageOf(e)}`); }
  finally { this.state.pendingEffect = null; this.setBusy(false); }   // REQ-4.3 clear
}
```

`label` is `Script error in button "AnswerA"` (from the receiving target) or `Message box`.
`sendCardMessage` (injected into DomHost) calls `dispatchMessage` directly, not `top()`, because it
always runs inside an existing top-level dispatch.

Errors raised inside nested `openCard`/`closeCard` dispatches propagate to the outer top-level call and
are reported once, labelled with the outermost receiver. The message text from `dispatchMessage`
already carries the line.

### Gestures

Pointer listeners use event delegation on the surface (`pointerdown`, `pointerover`) and the document
(`pointerup`, `pointercancel`). No pointer capture: the `pointerup` target is the element under the
pointer, which is exactly what the "released over the same target" rule needs.

1. `pointerdown` (primary button, not busy, no gesture in progress): find the target via
   `closest('[data-object-id]')` inside the current, non-inert card layer; skip unlocked fields.
   Hilite if `autoHilite`. Start one `top()` for the whole gesture: dispatch `mouseDown`, clear the
   pending effect, then await the release.
2. `pointerover` during a gesture: hilite on when the pointer is over the gesture's target, off
   otherwise.
3. `pointerup` / `pointercancel`: un-hilite and release the gesture with "same target" (cancel is
   never the same target). If same target, the card is unchanged and the stack was not reloaded,
   dispatch `mouseUp` inside the same `top()`. Otherwise drop.
4. Keyboard: a `click` event with `detail === 0` on a `.button` runs mouseDown then mouseUp in one
   `top()`, with a one-frame hilite.

Because busy is set for the whole press-to-release gesture, a second gesture cannot interleave.

### Load sequence

```
state = fresh(structuredClone(stack)); host = new DomHost(state, stage, sendCardMessage)
host.mountInitialCard()                        // card 0, no messages
top('Script error in card "<card 1 name>"', async () => {   // card 1 receives both messages
  await dispatch('openStack', cardContext)     // me = card 0, passes up to stack
  await dispatch('openCard', cardContext)
})
```

---

## Message box (messageBox.ts)

```ts
export const WRAPPER_HANDLER = 'messageBox';
export interface Wrapped { source: string; offset: number; declarations: number }
export function wrapStatement(line: string): Wrapped;
export function remapLine(message: string, offset: number): string;  // Line N → Line max(1, N - offset)
export async function runMessageBoxLine(line, host, globals): Promise<void>;
```

**Interim globals design.** The evaluator exposes a global only to handlers that declare it, and the
box runs one statement, so the box could never share globals with scripts. HyperCard treats
message-box variables as global, so `wrapStatement` tokenizes the typed line (`tokenize` from
`src/interp/tokenizer.ts`) and emits one `global <name>` line per distinct identifier token
(lowercased) between `on messageBox` and the typed line:

```
on messageBox            -- line 1
global ghost             -- lines 2 .. 1+k   (k = declarations)
put "Boo" into ghost     -- line 2+k         (offset = 1 + k)
end messageBox
```

Identifiers that are property, function or handler names get a harmless declaration. `it` is a
tokenizer keyword, so it is never declared and stays local. To be replaced by an `implicitGlobals`
option on `evaluate` in a later reviewed interpreter change (`necrotalk-reviewer`); then the wrapper
returns to three lines and `offset` to 1.

`runMessageBoxLine` rejects embedded newlines, tokenizes and wraps the line (tokenizer errors come
from the bare line and already say `Line 1`), parses, then checks the handler body: `body.length -
declarations` must be 1 (0 → no-op, e.g. a comment; > 1 → `Line 1: The message box runs one
statement.`). It calls `evaluate(script, 'messageBox', [], host, globals, {})` — no `me`.
`NecroTalkError`s with `line > 1` are rethrown with `remapLine(message, offset)`. An empty or
whitespace-only line does nothing. `BrowseRuntime.runMessageBox` runs it through `top('Message box', …)`.

`messageBox` is not a NecroTalk keyword, so the wrapper never collides with the reserved-word check.
`tokenize` and `parse` are imported here, in the UI layer; the evaluator still never imports either.

---

## Stack picker and boot

`stackPicker.ts` renders `<label>Stack <select id="stack-picker">` with the three fixture keys and
names. `main.ts`:

1. Builds the chrome: `header.chrome-toolbar` (picker), `main.card-viewport` (stage), `div.status-line`
   (`role="alert"`), `input.message-box`.
2. Reads `?stack=`; unknown values fall back to `quiz`.
3. `loadFixture(name)` → `runtime.load(stack)`; on failure shows `Could not load stack: …`.
4. Picker `change` (ignored while busy) → same path + `history.replaceState`.

The picker and message box are disabled (`disabled` attribute) while busy so the state is visible.

Chrome uses the light theme `#f0f0f0` (retro-ui "pick one"); it is never inherited by `.card-surface`.

---

## Testing strategy

| File | Env | Covers |
|---|---|---|
| `scale.test.ts` | node | REQ-1.2, PBT #3 |
| `objectOps.test.ts` | node | REQ-4.1, 4.6, 4.7, 4.8 errors; PBT #2 |
| `messageContext.test.ts` | node | REQ-5.1 table, background object path |
| `ditherMask.test.ts` | node | Bayer matrix is a permutation of 0..63; coverage monotone |
| `transitions.test.ts` | node + happy-dom | `frameStyle` per effect, PBT #4; `runTransition` cleanup |
| `renderCard.test.ts` | happy-dom | element types, classes, hidden, layering order, data attributes, no `innerHTML` |
| `renderField.test.ts` | happy-dom | locked vs unlocked, input writes back, scroll bar thumb position |
| `dialogs.test.ts` | happy-dom | answer resolves with clicked/Enter label; ask OK/Cancel/Escape; focus restore |
| `domHost.test.ts` | happy-dom | navigation order (closeCard → render → openCard), no-op same card, depth guard, effect consumed |
| `runtime.test.ts` | happy-dom | load sends openStack then openCard; mouseUp only on same target; busy drops gestures; error status text |
| `messageBox.test.ts` | happy-dom | wrap, remap, one-statement rule, globals shared; PBT #1 |
| `test/e2e/browse.spec.ts` | Playwright | REQ-8.3 quiz click-through |

PBT arbitraries reuse the shape of the `stack-model` stack arbitrary but constrain names to
`[A-Za-z0-9 ]{1,12}` unique per card so name-based lookup is unambiguous.

The Playwright config uses `webServer: { command: 'npm run dev -- --port 5174 --strictPort', url:
'http://localhost:5174' }` and Chromium only. `npm run e2e` → `playwright test`.

---

## Open questions (all five defaults accepted)

1. **Line numbers on host errors.** `DomHost` cannot know the statement line, and the evaluator does not
   wrap host errors, so `No field named "X"` is shown without `Line N:`. Default: accept for this spec.
   Fix later with a small `src/interp/` change (evaluator rethrows non-`NecroTalkError` host errors as
   `NecroTalkError` at `stmt.line`), reviewed by `necrotalk-reviewer`.
2. **Name-only `me`.** `ResolvedObjectRef` has no id, so duplicate names resolve to the first object.
   Default: accept; an optional `id` on `ResolvedObjectRef` would be an interpreter change.
3. **Fonts.** Accepted: `--font-ui` and `--font-field` fall back to `sans-serif`, `--font-script` to
   `monospace`, until `retro-skin` bundles OFL fonts.
4. **Message box ownership.** BRIEF section 12 lists the message box under `script-editor`. Default: this
   spec delivers the working box; `script-editor` adds highlighting and history on top of
   `messageBox.ts`.
5. **New dev dependencies.** `happy-dom` (DOM unit tests without a browser) and `@playwright/test`
   (e2e, required by tech.md). Both pinned exact at install time. Alternative to `happy-dom`: test
   DOM modules only through Playwright, slower feedback.
