# browse-mode — Tasks

Execute in order. Each task is independently verifiable. Do not start a task until the previous one
passes its acceptance check. Every task ends with `npm run typecheck`, `npm run lint` and `npm test`
green. No task modifies `src/interp/` or `src/model/`.

---

## Task 1 — Tooling: happy-dom, Playwright, CSS variables

**Steps:**
1. Install dev dependencies pinned exact (no `^`/`~`): `happy-dom`, `@playwright/test`. Record the
   versions installed. Run `npx playwright install chromium`.
2. Add `playwright.config.ts` at the repo root: `testDir: 'test/e2e'`, Chromium only, `webServer`
   running `npm run dev -- --port 5174 --strictPort` with `url: 'http://localhost:5174'`,
   `reuseExistingServer: !process.env.CI`.
3. Change the `e2e` script in `package.json` to `playwright test`.
4. ~~Add ignores to `.gitignore`~~ — already done (`test-results/`, `playwright-report/`,
   `.playwright-mcp/` are present). Skip.
5. Create `src/ui/variables.css`: `--card-width: 512px`, `--card-height: 342px`, `--black: #000`,
   `--white: #fff`, `--chrome-bg: #f0f0f0`, `--font-ui: sans-serif`, `--font-field: sans-serif`,
   `--font-script: monospace` (fallbacks until `retro-skin`), z-index band variables (`--z-dialog: 1000`).

**Acceptance:** `npm test` still green; `npx playwright --version` prints the pinned version;
`npm run e2e` runs and reports "No tests found" (or equivalent) without a config error.

---

## Task 2 — Pure helpers: scale, objectOps, messageContext

**Steps:**
1. `src/ui/browse/scale.ts`: `CARD_WIDTH`, `CARD_HEIGHT`, `computeScale` (REQ-1.2).
2. `src/ui/browse/objectOps.ts`: `ObjectHit`, `findObject`, `getProp`, `setProp` (REQ-4.1, 4.6–4.8),
   with the exact error messages from the requirements.
3. `src/ui/browse/messageContext.ts`: `buildCardContext`, `buildObjectContext` (REQ-5.1).
4. Tests (node env):
   - `scale.test.ts`: examples (1024×684 → 2, 1100×700 → 2, 400×300 → 0.78125, 0×0 → 1) and PBT #3.
   - `objectOps.test.ts`: card-before-background lookup, case-insensitive names, type mismatch, card /
     background / stack refs, every error message, `visible` parsing, and PBT #2 (≥ 200 runs).
   - `messageContext.test.ts`: `me` for each level; background object path; card context omits object.

**Acceptance:** all three test files green; PBTs run ≥ 200 examples.

---

## Task 3 — Object renderers and card renderer

**Steps:**
1. `renderButton.ts`, `renderField.ts`, `scrollBar.ts`, `renderImage.ts` per REQ-2 and the design.
2. `renderCard.ts`: background layer then card layer, `data-object-id` / `data-object-name`,
   `hidden` for invisible objects, id → element map, `onFieldInput` hook.
3. `src/ui/browse/browse.css`: card surface reset and defaults (REQ-1.3), object styles, focus ring,
   placeholder dither, and `.card-surface .card-object[hidden] { display: none !important; }`
   (REQ-2.4). Only `#000`/`#fff` inside `.card-surface`; no gradients, shadows, transitions.
4. Tests (happy-dom): `renderCard.test.ts`, `renderField.test.ts` — element tag per type, classes per
   style, accessible names, hidden handling (a `visible: false` object has the `hidden` attribute, and
   `browse.css` contains the `[hidden]` rule), z-order, unlocked field input updates the model, scroll
   bar thumb moves on `scroll`, and a guard test that rendering a field whose text is `<img src=x
   onerror=alert(1)>` produces a text node, not an element. `renderCard.test.ts` uses an inline stack
   with at least one background object and asserts background objects render below card objects
   (REQ-3.4).

**Acceptance:** tests green; `grep -r innerHTML src/ui` finds no use with stack content.

---

## Task 4 — Stage

**Steps:**
1. `stage.ts`: `CardStage` creates `.card-viewport` → wrapper → `.card-surface` (`role="application"`,
   `aria-label="HyperCard stack"`, `data-card-index`, `data-card-name`, `data-busy`), applies
   `computeScale` on `ResizeObserver` callbacks, exposes `surface`, `setCardLayer(layer)`, `setBusy(b)`.
2. Minimal test (happy-dom): attributes present, `setBusy` toggles `data-busy`.

**Acceptance:** tests green.

---

## Task 5 — Transitions

**Steps:**
1. `ditherMask.ts`: `BAYER_8`, `maskCoverage`, `ditherMaskUrl`; precompute the 11 URLs.
2. `transitions.ts`: `TRANSITION_DURATION_MS = 333`, `TRANSITION_FRAMES = 11`, `frameStyle`,
   `runTransition` (rAF, time-based discrete frames, old layer `inert`, cleanup, reduced motion).
3. Tests: `ditherMask.test.ts` (Bayer is a permutation of 0..63; frame 0 → 0 cells, frame 11 → 64;
   monotone), `transitions.test.ts` (per-effect frame 0 / frame 11 / intermediate values in whole
   pixels; PBT #4; `runTransition` resolves, removes old layer and clears inline styles under fake
   timers; reduced motion resolves without frames).

**Acceptance:** tests green; no `transition:` or `animation:` declarations in `browse.css` for card
navigation.

---

## Task 6 — Dialogs

**Steps:**
1. `dialogs.ts`: `showAnswer`, `showAsk` per REQ-4.4, 4.5 and the design (inside the surface, manual
   focus trap, `inert` on card layer and message box, focus restore).
2. Dialog styles in `browse.css` (double border, default-button ring, z-index ≤ 1000).
3. `dialogs.test.ts` (happy-dom): one/three buttons, click resolves label, Enter resolves default (last)
   button, Escape ignored for answer; ask pre-fills and selects default, OK/Enter returns text,
   Cancel/Escape returns `""`; focus lands on default and is restored; backdrop removed.

**Acceptance:** tests green.

---

## Task 7 — DomHost

**Steps:**
1. `domHost.ts`: `DomHost implements HostInterface` with `mountInitialCard` and the injected
   `SendCardMessage` (REQ-4, design pseudocode). Add `BrowseState` type (in `runtime.ts` or a small
   `state.ts` if that keeps files under 300 lines).
2. `domHost.test.ts` (happy-dom, with a recording `sendCardMessage`):
   - `goToCard` order: `closeCard` (old card still current) → render → index updated → `openCard`.
   - same-index no-op; out-of-range error text; depth guard at 17 nested calls.
   - pending effect consumed by `goToCard`, replaced by a second `setVisualEffect`.
   - show/hide/set/get update both the model and the on-screen element.
   - `answer`/`ask` delegate to dialogs (resolve via simulated clicks).
   - `random` stays in `[1, n]`; `getDate`/`getTime` match `^\d{1,2}/\d{1,2}/\d{2}$` and
     `^\d{1,2}:\d{2} (AM|PM)$`.
   - inline stack with a background field: `setFieldText` on card 1, `goToCard` to card 2 (same
     background), `getFieldText` and the on-screen element show the new text (REQ-3.3, REQ-3.4).

**Acceptance:** tests green; `DomHost` satisfies `HostInterface` with no extra members needed by the
evaluator.

---

## Task 8 — Runtime: messages, gestures, busy, errors

**Steps:**
1. `runtime.ts`: `BrowseRuntime` with `load`, top-level dispatch wrapper, gesture handling (REQ-5.2),
   keyboard activation, busy handling (REQ-5.4), status line errors (REQ-5.5), pending-effect clearing
   (REQ-4.3).
2. `runtime.test.ts` (happy-dom), using small inline stacks with scripts that `put` into a field so
   effects are observable:
   - load sends `openStack` then `openCard` to card 1, with `me` = card 1 (stack script handles
     `openStack` via pass-through).
   - `mouseDown` and `mouseUp` reach the button with `me` = the button; release outside sends no
     `mouseUp`; `mouseUp` dropped when `mouseDown` navigated.
   - click on bare card area sends `mouseUp` to the card.
   - unlocked field sends nothing; locked field does.
   - gesture while busy (pending `answer`) is ignored.
   - a script error shows `Script error in button "X": Line 2: …` and clears busy.
   - `visual effect dissolve` without `go` does not leak into the next gesture.
   - a background button with no handler of its own: `mouseUp` passes object → card → background →
     stack; with `pass mouseUp` at each level, every level runs in order with the right `me`
     (REQ-3.4, REQ-5.1).

**Acceptance:** tests green.

---

## Task 9 — Message box

**Steps:**
1. `messageBox.ts`: `wrapStatement`, `remapLine`, `runMessageBoxLine` (REQ-7; runs with
   `implicitGlobals`).
2. Wire into `BrowseRuntime.runMessageBox` with the `Message box:` status prefix.
3. `messageBox.test.ts`: `go next` navigates; `put "x" into field "Name"` updates the field; two
   statements rejected; `on`/`end` structure rejected; line numbers remapped by the wrapper offset;
   `me` error; globals shared with a handler in both directions;
   globals shared with a handler; empty line no-op; PBT #1 navigation range (≥ 200 runs) with
   `data-card-index` agreement.

**Acceptance:** tests green.

---

## Task 10 — Stack picker, chrome, boot

**Steps:**
1. `stackPicker.ts` per REQ-6 (order, labels, `?stack=`, `replaceState`, disabled while busy).
2. `src/main.ts`: import `variables.css` and `browse.css`, build the chrome (toolbar, viewport, status
   line, message box), boot with `loadFixture`, handle load failure message.
3. `index.html`: keep `#app`; no inline styles or scripts beyond the module entry.
4. Run `npm run dev` in the background and confirm with the Playwright MCP `browser_snapshot` that the
   quiz title card renders with its button and field, then stop the server.

**Acceptance:** `npm run build` succeeds; dev server shows the quiz title card; switching to each of the
three stacks renders its first card with no console errors.

---

## Task 11 — End-to-end test and Playwright MCP smoke

**Steps:**
1. `test/e2e/browse.spec.ts` per REQ-8.3: `/?stack=quiz` → click `Enter if you dare...` → click one
   answer on Q1, Q2, Q3 (by accessible name, e.g. `A) A zombie`, `B) October`, `B) A lit
   jack-o-lantern`) → after each click wait for `[data-busy="false"]` and the expected
   `data-card-name` → assert `Results` and the text `You survived the Haunted Quiz!`.
2. `npm run e2e` — must pass.
3. Playwright MCP smoke (REQ-8.4): start `npm run dev` in the background; `browser_navigate` to
   `http://localhost:5173/?stack=quiz`; `browser_snapshot` to get refs; `browser_click` through the same
   four buttons, taking a `browser_snapshot` after each to confirm the card name; on the Results card,
   `browser_take_screenshot` (`filename: .playwright-mcp/browse-quiz-results.png`). Check
   `browser_console_messages` for errors. Stop the dev server.
4. Add a short entry to `KIRO_USAGE.md`: what the MCP smoke did, the result, and any difference from the
   committed e2e test.

**Acceptance:** `npm run e2e` green; the MCP run reaches the Results card with no console errors and the
screenshot exists.

---

## Task 12 — Final verification

**Steps:**
1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e` — all exit 0.
2. Confirm every file in `src/ui/browse/` is under ~300 lines and matches the design module map.
3. Confirm imports: `src/ui/` imports only `src/model/` and `src/interp/`; `git diff --stat` shows no
   change under `src/interp/` or `src/model/`.
4. Confirm `package.json` has no `^`/`~` ranges and the only new dependencies are `happy-dom` and
   `@playwright/test` (dev).
5. Grep `src/ui` for `eval(`, `new Function`, `innerHTML`, `linear-gradient`, `box-shadow`,
   `opacity`, `transition:` — none on card content.
6. Optionally run the `retro-design-reviewer` agent (if it exists by then) against `browse.css` with a
   screenshot.

**Acceptance:** all checks pass. The spec is done when this task is green.
