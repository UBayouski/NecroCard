# browse-mode — Requirements

## Overview

Make a NecroCard stack playable in the browser. Render a `Stack` from `src/model/` as DOM at 512 × 342
logical pixels scaled to fit, run its NecroTalk scripts through a real `HostInterface` implementation
(`DomHost`), and wire the system messages through `dispatchMessage`. Ship a stack picker for the three
bundled fixtures and a one-line message box.

This is spec 3 of 8. It depends on `stack-model` (types, `loadFixture`) and `necrotalk-interpreter`
(`HostInterface`, `ResolvedObjectRef`, `dispatchMessage`, `resolveNavigation`, `parse`, `evaluate`).

Sources: `docs/BRIEF.md` sections 3, 5 (browse mode, message box) and 8; steering `product.md`,
`structure.md`, `retro-ui.md`.

### In scope

Card rendering and scaling; button, field and image rendering per style; `DomHost`; the four stepped
transitions; 1-bit `answer` and `ask` dialogs; show/hide; property get/set for `label`, `text`, `visible`;
field text read/write; `mouseDown`, `mouseUp`, `openCard`, `closeCard`, `openStack`; stack picker; message
box; Vitest unit and property tests; one Playwright e2e test; a Playwright MCP smoke run.

### Out of scope

Edit mode, Summon, sharing and persistence (no autosave, no export), the script editor, bundled fonts
and dither-pattern polish (spec `retro-skin`), Phase 2 NecroTalk, any change to the grammar, any new
object type or property.

---

## REQ-1 — Card stage and scaling

### REQ-1.1 — Logical size

The card is rendered into one element `.card-surface` that is always exactly 512 × 342 CSS pixels
(`--card-width`, `--card-height` in `src/ui/variables.css`). Object `rect` values are applied as
inline `left`, `top`, `width`, `height` in `px` relative to the card surface. No percentage or viewport
units on the card element.

### REQ-1.2 — Scale to fit

The surface is scaled with `transform: scale(s)` (origin top-left) to fit the space available below
the chrome toolbar and above the message box. With available width `W` and height `H`:

- `raw = min(W / 512, H / 342)`
- if `raw >= 1`, `s = floor(raw)` (integer scaling keeps logical pixels crisp)
- otherwise `s = raw` (small viewports shrink; never clipped)

The scale is recomputed when the viewport is resized. The scaled card is centred horizontally.

### REQ-1.3 — Card surface defaults

`.card-surface` has `role="application"`, `aria-label="HyperCard stack"`, `overflow: hidden`, a white
background, black text, `image-rendering: pixelated`, and resets every inherited colour, background
and font property so chrome styles never bleed in (retro-ui "Chrome vs. card surface").

### REQ-1.4 — Layering and hit testing

Objects of the current card's background are rendered first, then the card's own objects. Within each
layer, array order is z-order (later is on top). Hit testing is the browser's: the topmost visible
object under the pointer receives the event. Objects with `visible: false` are not rendered as hit
targets. A click on the card surface that hits no object targets the card itself.

### REQ-1.5 — Test hooks

The card surface carries `data-card-index` (0-based), `data-card-name`, and `data-busy`
(`"true"` while a message dispatch, transition or dialog is in progress, else `"false"`). Every object
element carries `data-object-id` and `data-object-name`. These attributes are the only contract the
e2e tests rely on, apart from accessible names.

---

## REQ-2 — Object rendering

All visual rules come from `retro-ui.md`. Only `#000` and `#fff` are used on the card surface. No
gradients, shadows, blur, opacity effects, or CSS transitions on card content.

### REQ-2.1 — Buttons

- Rendered as a real `<button type="button">` with user-agent styles reset, absolutely positioned at
  its `rect`, label centred, using the `font-ui` class. Accessible name is the label, or the button
  `name` when the label is empty.
- `rect`: 1px black border, white fill, 1px bevel. `roundRect`: same with fixed 8px radius and a
  heavier border. `transparent`: no border, no fill, label only.
- `autoHilite: true`: while the pointer is pressed on the button and still over it, the button is
  inverted (black fill, white label) via the `button--hilite` modifier. No transition.
- Classes: `card-object`, `button`, `button-rect` | `button-roundrect` | `button-transparent`.

### REQ-2.2 — Fields

- `lockText: true`: rendered as a non-editable element showing `text` with `white-space: pre-wrap`,
  not focusable, no text cursor. Accessible name is the field name.
- `lockText: false`: rendered as a `<textarea>` with user-agent styles reset, inside the positioned
  field `<div>` (the `div` is the card object; it also holds the scroll bar for `scrolling` fields).
  Typing updates the field's `text` in the runtime stack on every `input` event.
- `rect`: 1px black border, white fill. `transparent`: no border, no fill. `scrolling`: 1px black border
  plus a 16px-wide 1-bit scroll bar on the right drawn with DOM elements (not the native scroll bar):
  up arrow, down arrow, track, and a proportional thumb. Arrows scroll one line, a track click scrolls
  one page, the mouse wheel scrolls, and the thumb position tracks `scrollTop`. Thumb dragging is
  deferred to `retro-skin`.
- Text uses the `font-field` class, line height 1.2.
- Classes: `card-object`, `field`, `field-rect` | `field-scrolling` | `field-transparent`, plus
  `field--locked` when locked.

### REQ-2.3 — Images

- A `src` that starts with `data:image/` is rendered as an `<img>` with `alt` set to the image name,
  `image-rendering: pixelated`, sized to the rect, `draggable="false"`.
- Any other `src` (asset id) is rendered as a placeholder box: 1px black border, 50% dither fill from
  an inline SVG data URL, `role="img"` and `aria-label` set to the image name. No network request is
  made. Dithering on import belongs to `edit-mode`.
- Classes: `card-object`, `image` (and `image--placeholder`).

### REQ-2.4 — Visibility

An object with `visible: false` is rendered with the `hidden` attribute. Changing visibility updates
only that element. Because object styles use `all: unset` followed by an explicit `display`, author
rules would beat the user-agent `[hidden] { display: none }`; `browse.css` therefore contains
`.card-surface .card-object[hidden] { display: none !important; }` (the UA-reset `!important`
exception retro-ui allows).

---

## REQ-3 — Runtime stack state

### REQ-3.1 — Working copy

Loading a stack takes a deep copy (`structuredClone`) of the `Stack` returned by `loadFixture`. All
script effects (show/hide, `set`, field text, typed field edits) mutate the working copy and are kept
when navigating away and back, as in HyperCard. The original fixture object is never mutated.

### REQ-3.2 — No persistence

Switching stacks or reloading the page discards the working copy. Nothing is written to storage.

### REQ-3.3 — Background objects are shared

A background object exists once in the model, so changing its `text`, `label` or `visible` is seen on
every card using that background. This is a consequence of the frozen model, not a bug; no per-card
background text is added. A test must show a background field's text changed on one card is seen
after navigating to another card that shares the background.

### REQ-3.4 — Background coverage in tests

None of the three fixtures has background objects, so `renderCard.test.ts`, `domHost.test.ts` and
`runtime.test.ts` each use an inline stack with at least one background object, and between them
cover background rendering, background object lookup, and the object → card → background → stack
message path.

---

## REQ-4 — DomHost (HostInterface implementation)

`DomHost` in `src/ui/browse/domHost.ts` implements `HostInterface` from `src/interp/evaluator.ts`
exactly; no members are added to or removed from the interface.

### REQ-4.1 — Object lookup

A `ResolvedObjectRef` of type `button`, `field` or `image` is resolved against the current card:
card objects first (in z-order from bottom to top), then background objects, matching `type` exactly
and `name` case-insensitively. The first match wins. A ref of type `card` matches a card in the stack
by name, case-insensitively. A ref of type `background` or `stack` (only reachable through `me`)
resolves to the current background or the stack.

If nothing matches, the host throws an `Error` whose message is `No <type> named "<name>"`
(for example `No field named "Score"`).

### REQ-4.2 — Navigation

- `getCurrentCardIndex`, `getCardCount`, `getCardNames` read the working copy. The evaluator resolves
  `go` targets with `resolveNavigation` before calling `goToCard`; `DomHost` performs no target
  resolution of its own, and every other navigation path in the UI (stack load) also goes through
  `goToCard` with a valid 0-based index.
- `goToCard(index)` with `index` outside `[0, cardCount - 1]` throws `Card index <index+1> is out of range`.
- `goToCard(index)` equal to the current index is a no-op: no messages, no transition. The pending
  visual effect is consumed.
- Otherwise, in order: dispatch `closeCard` to the current card; render the target card; run the
  pending visual effect (if any) between the old and new card; set the current index; dispatch
  `openCard` to the new card. The returned promise resolves after the `openCard` dispatch completes.
- A `go` inside `openCard` or `closeCard` is allowed. Nested `goToCard` calls deeper than 16 throw
  `Too many nested go commands` so a card that redirects to itself cannot hang the page.

### REQ-4.3 — Visual effects

- `setVisualEffect(effect)` stores one pending effect; a later call replaces it. The next `goToCard`
  that changes card consumes it.
- The pending effect is cleared when the top-level dispatch that set it finishes, even if no `go`
  followed (HyperCard semantics).
- The four effects follow `retro-ui.md` "Visual transitions":

| Effect | Behaviour |
|---|---|
| `dissolve` | New card above old, revealed through a 1-bit 8 × 8 ordered-dither `mask-image` that gains coverage each frame |
| `wipe left` | New card revealed from the right edge towards the left via `clip-path: inset(...)` |
| `wipe right` | New card revealed from the left edge towards the right via `clip-path: inset(...)` |
| `scroll up` | Old card moves up via `transform: translateY` while the new card follows from below |

- `TRANSITION_DURATION_MS = 333` and `TRANSITION_FRAMES = 11`, constants in `transitions.ts`. Frames are
  discrete: every visible step uses whole logical pixels (wipe and scroll) or one of 11 precomputed
  masks (dissolve). Steps are driven by `requestAnimationFrame` with a time-based frame index, never
  by CSS `transition` or `animation`.
- The old card is the existing DOM node marked `inert`; the DOM is never rasterized and pixel data
  is never read back.
- When `prefers-reduced-motion: reduce` matches, the transition is skipped and the new card appears
  in one step. Messages are unchanged.

### REQ-4.4 — answer dialog

`answer(prompt, buttons)` shows a modal 1-bit dialog inside the scaled card stage:

- Double black border, white fill, prompt text in `font-ui`, buttons right-aligned in source order.
  The last button is the default and has a heavy rounded outline, as on the classic Mac.
- 1 to 3 buttons (the parser guarantees this; `["OK"]` when no `with`).
- Clicking a button, or pressing Enter for the default button, closes the dialog and resolves with
  that button's label. Escape does nothing (answer has no cancel).
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at the prompt; focus moves to the
  default button and is trapped in the dialog; focus returns to the previously focused element.
- While open, the card and message box do not receive input.

### REQ-4.5 — ask dialog

`ask(prompt, defaultValue)` shows the same dialog frame with the prompt, a one-line text input
pre-filled with `defaultValue` and fully selected, and `Cancel` and `OK` buttons (`OK` is default).
OK or Enter resolves with the input text; Cancel or Escape resolves with `""`.

### REQ-4.6 — show / hide

`showObject` and `hideObject` set `visible` to `true` / `false` on the resolved button, field or image
and update its element. For a ref of type `card`, `background` or `stack` they throw
`Cannot show a card` / `Cannot hide a card` (with the actual type).

### REQ-4.7 — Properties

Property names are matched case-insensitively. Values cross the interface as strings.

| Property | Button | Field | Image | Get | Set |
|---|---|---|---|---|---|
| `label` | yes | — | — | the label | replaces the label and re-renders it |
| `text` | — | yes | — | the field text | replaces the text and re-renders it |
| `visible` | yes | yes | yes | `"true"` or `"false"` | `"true"` / `"false"` (case-insensitive); anything else throws `Expected true or false but got "<v>"` |

Any other property, or a listed property on an object type that does not have it (including cards,
backgrounds and the stack), throws `Unknown property "<name>"`.

### REQ-4.8 — Field text

`getFieldText` and `setFieldText` read and write `text` on the resolved field; a non-field ref throws
`No field named "<name>"`. `setFieldText` on an unlocked field that has focus preserves the caret at
the end of the text.

### REQ-4.9 — Built-ins

- `beep()`: a ~100 ms square-wave tone via Web Audio; silent no-op if Web Audio is unavailable or
  blocked.
- `getDate()`: US short date, e.g. `11/3/26`. `getTime()`: e.g. `2:05 PM`. Both from the local clock.
- `random(n)`: uniform integer in `[1, n]`.

---

## REQ-5 — Message wiring

### REQ-5.1 — Message context and `me`

Every message is sent through `dispatchMessage` with a `MessageContext` built from the working copy:

| Level | Script | `me` |
|---|---|---|
| object | the object's `script` | `{ type: obj.type, name: obj.name }` |
| card | current card `script` | `{ type: 'card', name: card.name }` |
| background | the card's background `script` | `{ type: 'background', name: background.name }` |
| stack | stack `script` | `{ type: 'stack', name: stack.name }` |

Card-level messages (`openCard`, `closeCard`, `openStack`, and clicks that hit no object) omit the
object level. A background object's message path is object → card → background → stack. Order never
deviates.

### REQ-5.2 — Mouse messages

- `mouseDown` is sent on primary-button `pointerdown` on a button, a locked field, an image, or the bare
  card.
- `mouseUp` is sent on `pointerup` only when the pointer is released over the same target it went down
  on (HyperCard behaviour). Releasing elsewhere sends nothing.
- `mouseUp` is dispatched only after the `mouseDown` dispatch of the same gesture has finished. If the
  current card changed during `mouseDown`, the `mouseUp` is dropped.
- Unlocked fields do not send mouse messages; clicks place the caret.
- Keyboard activation of a focused button (Enter or Space) sends `mouseDown` then `mouseUp`, with the
  hilite shown for one frame when `autoHilite` is true.

### REQ-5.3 — Card and stack messages

- Loading a stack: render card 1 (index 0), then send `openStack`, then `openCard`, both to card 1.
  Card 1 is the receiver of both, so an error during load is labelled with card 1
  (`Script error in card "<card 1 name>": …`, REQ-5.5), not with the stack.
- `closeCard` and `openCard` on every card change, as defined in REQ-4.2.
- No messages are sent to a stack being unloaded.

### REQ-5.4 — One script at a time

While a dispatch is running (including its dialogs and transitions) the runtime is busy
(`data-busy="true"`). New pointer gestures, message-box submissions and stack-picker changes are
ignored while busy; only the queued `mouseUp` of the current gesture is allowed through.

### REQ-5.5 — Script errors

Any error thrown by a dispatch (parse error, `NecroTalkError`, or a `DomHost` error) stops that
dispatch, is logged with `console.error`, and is shown in a status line below the card
(`role="alert"`) as:

```
Script error in <type> "<name>": <message>
```

where `<type> "<name>"` is the object, card, background or stack that received the message (e.g.
`Script error in button "AnswerA": Line 2: No card named "Q9".`). The receiver is where the message
entered the path, not the level whose handler failed; `openStack` and `openCard` on load are received
by card 1, so load errors read `Script error in card "<card 1 name>": …`. Host errors carry no line number
in this spec (see design, open question 1). The status line clears on the next successful gesture,
message-box run, or stack load. The runtime returns to not-busy.

---

## REQ-6 — Stack picker

- A labelled `<select>` ("Stack") in the chrome toolbar lists the three fixtures in this order:
  `The Haunted Quiz` (`quiz`), `The Cursed Manor` (`adventure`), `Spooky Flashcards` (`flashcards`).
  Option values are the fixture keys; option text is hard-coded to match the fixture `name`s so the
  picker renders without loading all three stacks.
- On start, the stack named by the `?stack=<quiz|adventure|flashcards>` query parameter is loaded;
  default `quiz`. Changing the selection loads that fixture (REQ-3.1, REQ-5.3) and updates the query
  parameter with `history.replaceState`.
- A fixture that fails to load or validate shows `Could not load stack: <message>` in the status line
  and leaves the previous stack running.

---

## REQ-7 — Message box

- A single-line text input at the bottom of the window, below the card, class `message-box`,
  `font-script`, accessible name "Message box".
- Enter runs the line as exactly one NecroTalk statement against the current card, using
  `evaluate` with the same `DomHost` and the stack's globals. `me` is not available (the evaluator
  reports `"me" is not available here`).
- **Globals (interim design).** As in HyperCard, variables used in the message box are global. The
  evaluator only exposes a global to a handler that declares it, and a one-statement box cannot
  declare and use a variable in the same line, so the line is wrapped as:

  ```
  on messageBox
  global <id1>          -- one line per distinct identifier token in the typed line, lowercased
  global <id2>
  <typed line>
  end messageBox
  ```

  Identifiers that turn out to be property, function or handler names are harmless. `it` is a
  keyword, so it is never declared and stays local. This is interim: it will be replaced by an
  `implicitGlobals` option on `evaluate` in a later, reviewed interpreter change
  (`necrotalk-reviewer`), after which the wrapper goes back to three lines.
- Line numbers in errors are mapped back so the typed line is line 1: with `offset = 1 + <number of
  global lines>`, `Line N:` in the wrapped source becomes `Line max(1, N - offset):`. Tokenizer errors
  come from the bare line and already say `Line 1`. A line that contains `on`/`end` handler structure,
  or more than one statement, is rejected (`Line 1: The message box runs one statement.` or the
  parser's error, remapped).
- Errors appear in the status line as `Message box: <message>`.
- After a run the text stays in the box and is selected, as in HyperCard. Up/Down arrows are not
  required (no history).
- Globals are shared with scripts in both directions: a value the box puts into `x` is seen by a
  handler that declares `global x`, and vice versa.

---

## REQ-8 — Testing

### REQ-8.1 — Unit tests (Vitest)

Co-located `*.test.ts` for every module in `src/ui/browse/`. DOM-dependent tests run under the
`happy-dom` environment selected per file with `// @vitest-environment happy-dom`; pure modules run in
the default Node environment.

### REQ-8.2 — Property-based tests (fast-check, ≥ 200 runs each)

1. **Navigation range**: for any fixture-shaped stack of 1–10 cards and any sequence of `go` statements
   run through the message box, `getCurrentCardIndex()` stays in `[0, cardCount - 1]` and equals the
   surface's `data-card-index`.
2. **Property round-trip**: for any button and any string `v` (no `"`, CR or LF), `setProperty(ref,
   'label', v)` then `getProperty(ref, 'label')` returns `v`; the same for field `text` via
   `setFieldText`/`getFieldText`, and for `visible` with `true`/`false`.
3. **Scale**: for any `W, H > 0`, the computed scale satisfies `512·s <= W` and `342·s <= H`, and `s`
   is an integer whenever `s >= 1`.
4. **Transition frames**: for every effect, frame 0 shows only the old card, frame 11 only the new
   card, and coverage of the new card is non-decreasing frame by frame.

### REQ-8.3 — End-to-end (Playwright)

`test/e2e/browse.spec.ts` loads `/?stack=quiz`, clicks `Enter if you dare...`, then one answer on each
of Q1, Q2 and Q3, waiting for `data-busy="false"` after each click, and asserts the surface has
`data-card-name="Results"` and shows `You survived the Haunted Quiz!`. `npm run e2e` runs it against
the Vite dev server.

### REQ-8.4 — Playwright MCP smoke

During implementation, the same click-through is driven once through the Playwright MCP server
(`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_take_screenshot`) and the Results
card screenshot is recorded in `KIRO_USAGE.md`.

---

## REQ-9 — Module boundaries and constraints

- New code lives in `src/ui/browse/` plus `src/ui/variables.css` and `src/main.ts`.
- `src/ui/` may import `src/model/` and `src/interp/` only; no `summon/`, `share/`, `worker/`.
- No change to `src/interp/` or `src/model/` in this spec. If one becomes necessary it is a separate,
  reviewed change (`necrotalk-reviewer`).
- No UI framework, no CSS framework, no CSS-in-JS, no `eval`, no `new Function`, no `innerHTML` with
  stack content (text is set with `textContent` / `value`).
- Files stay under ~300 lines; one primary export per file where practical.
- New dev dependencies, pinned exact: `happy-dom`, `@playwright/test`. No new runtime dependencies.
