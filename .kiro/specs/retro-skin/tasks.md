# retro-skin — Tasks

Execute in order. Each task is independently verifiable. Do not start a task until the previous one passes its
acceptance check. Every task ends with `npm run typecheck`, `npm run lint` and `npm test` green. No task modifies
`src/interp/`, `src/model/`, `src/summon/`, `src/share/` or `server/`, and no task adds a dependency.

---

## Task 1 — Shared patterns module and the dither set

**Steps:**
1. `src/ui/patterns.ts`: move `BAYER_8` here; add `DITHER_DENSITIES`, `ditherCellCount`, `ditherTileSvg`,
   `ditherTileUrl`.
2. `src/ui/browse/ditherMask.ts` and `src/ui/edit/dither.ts`: import `BAYER_8` from `../patterns.js`; remove the
   definition from `ditherMask.ts`.
3. `src/ui/patterns.test.ts`: density pixel counts (12.5→8 … 87.5→56, 50→32), monotonic, `BAYER_8` permutation and
   first row. Move the `BAYER_8` assertions out of `ditherMask.test.ts` (which now imports from `patterns.ts`).
4. `src/assets/patterns/dither.ts` if the tiles live there instead of `patterns.ts` (design — default: in
   `patterns.ts`).

**Acceptance:** `patterns.test.ts`, `ditherMask.test.ts`, `dither.test.ts` all green; no behaviour change.

---

## Task 2 — Fonts

**Steps:**
1. Download the three OFL fonts, commit woff2 + license beside each in `src/assets/fonts/`, write `FONTS.md`.
2. `src/assets/fonts/fonts.css`: the `@font-face` rules with local `url(...)` and the `Necro*` aliases.
3. `src/ui/variables.css`: bind `--font-ui/field/script` to the aliases; add the font-size tokens.
4. Import `fonts.css` in `src/main.ts` before the other stylesheets.
5. `src/ui/fonts.test.ts`: three `@font-face` with local urls and no `https://fonts.`; each `--font-*` bound to a
   `Necro*` family; no Apple font name anywhere under `src/`.

**Acceptance:** tests green; `npm run build` bundles the font files; grep for `Chicago|Geneva|Monaco` under `src/`
is empty.

---

## Task 3 — Card surface restyle

**Steps:**
1. Restyle buttons, fields, scroll bar (50 % dither thumb track), answer/ask dialogs and the message box under
   `.card-surface` with the new fonts, 1-bit only; `image-rendering: pixelated` on the card element.
2. `src/ui/cardSurface.test.ts`: the REQ-7.1 guard over every file with `.card-surface` rules.
3. Keep DOM classes stable so browse/edit/script-editor tests pass; update a test only if a class truly changed.

**Acceptance:** guard test green; all existing browse/edit tests green; the card shows only `#000`/`#fff`.

---

## Task 4 — Window frame and chrome

**Steps:**
1. `window-frame.css` (or a chrome.css section): the `.card-window` frame, title bar with the stack name and racing
   stripes, 1-bit, CSS only. `main.ts` wraps the viewport and sets the title (a `setCardTitle` helper).
2. Restyle `chrome.css`, the inspector, the script-editor frame, and the Summon/Settings/Share dialog CSS to the
   System 6 gray look; dialogs keep their shadow; the script editor keeps its token colours.
3. Keep the existing dialog/inspector tests green (class names stable).

**Acceptance:** `npm run build` succeeds; existing UI tests green; the title bar shows the open stack's name
(checked in the Task 7 e2e).

---

## Task 5 — Edit selection outline

**Steps:**
1. Inflate the selection outline by 2px (2px outside the rect on every side); handles stay on the true rect.
2. Extend an overlay/edit test: the outline box is 4px wider and taller than the object rect; handle coordinates are
   unchanged.

**Acceptance:** tests green; the outline clears a round-rect border.

---

## Task 6 — README

**Steps:**
1. Replace the scaffolding-status line with a one-paragraph status and `https://necrocard.onrender.com`.
2. Add a font-attributions section pointing at `src/assets/fonts/FONTS.md` with the three families, designers and the
   SIL Open Font License.

**Acceptance:** README has the live URL and the attributions; no Apple font names.

---

## Task 7 — End-to-end and Playwright MCP

**Steps:**
1. `test/e2e/retro-skin.spec.ts`: `document.fonts.ready` then `document.fonts.check('12px "NecroField"')` and
   `check('8px "NecroUI"')` true; the card's computed `font-family` resolves to a `Necro*` family; screenshot the
   quiz title card at 2× scale and commit it (design location).
2. `npm run e2e` — all spec files pass.
3. Ask the user to start `npm run dev`. Through Playwright MCP, one dependent action per call with a
   `browser_evaluate` state check before each screenshot: the quiz title card (`retro-title.png`), a scrolling field
   (`retro-scrolling.png`), an answer dialog triggered by a script (`retro-answer.png`), and the Edit-mode inspector
   (`retro-inspector.png`).
4. `KIRO_USAGE.md` entry.

**Acceptance:** `npm run e2e` green; the MCP shots show the bitmap fonts and 1-bit card with no console errors.

---

## Task 8 — Final verification

**Steps:**
1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run server:build`, `npm run e2e` — all
   exit 0.
2. `git status -- src/interp src/model src/summon src/share server` is clean; `package.json` dependencies unchanged.
3. Grep `src/` for `Chicago|Geneva|Monaco` (empty); grep card CSS for the forbidden tokens (empty); confirm the three
   font files, their licenses and `FONTS.md` are committed.
4. Files under ~300 lines; the card surface is still 512 × 342.

**Acceptance:** all checks pass.
