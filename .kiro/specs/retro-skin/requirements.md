# retro-skin — Requirements

## Overview

The visual pass. It makes the 512 × 342 card surface look like a 1984 Macintosh screen — 1-bit black and white,
bitmap fonts at their native pixel size, hard edges — and the chrome around it look like a quiet System 6 desktop in
light Mac gray. It adds three open-licensed bitmap-style fonts, the full classic 8 × 8 dither set, a HyperCard-style
window frame around the card, and a consistent chrome restyle of the toolbar, picker, inspector, script editor and
the Summon / Settings / Share dialogs. It changes no behaviour.

This is spec 8 of 8, the last. It builds on every prior spec's DOM and reads the rules in `retro-ui.md`.

Sources: `docs/BRIEF.md` section 8 (visual design); steering `retro-ui.md` (the prime directive, 1-bit rendering,
dither set, typography, dimensions, chrome vs. card, transitions, buttons, fields, edit affordances, accessibility,
the "what not to do" list).

### In scope

Three `@font-face` bitmap fonts with committed files, licenses and attributions; the 8 × 8 dither pattern set and a
shared `src/ui/patterns.ts` holding `BAYER_8`; the card surface (buttons, fields, scroll bars, answer/ask dialogs,
message box) styled 1-bit with the new fonts; a CSS HyperCard window frame around the card; the chrome restyle; a
2px-inflated edit selection outline; a CSS test forbidding gradients/shadows/opacity/system fonts inside
`.card-surface`; a font-load e2e check and a committed reference screenshot; one Playwright MCP run.

### Out of scope

Any change to `src/interp/`, `src/model/`, `src/summon/`, `src/share/` or `server/`; new runtime or dev
dependencies; new dither algorithms (the Bayer matrix is unchanged, only relocated); animation or easing (transition
timing is owned by `transitions.ts` and untouched); a dark chrome theme; icon artwork or raster images in the chrome;
mobile layout.

---

## REQ-1 — Fonts (`src/assets/fonts/`)

### REQ-1.1 — Three families, open-licensed, bitmap-style

Three web fonts, each an open-licensed classic-Mac-style lookalike, loaded by `@font-face` in
`src/assets/fonts/fonts.css` and bound to the three CSS variables:
- `--font-ui`: a bold, chunky bitmap UI font (menus, toolbar, inspector, dialog chrome).
- `--font-field`: a proportional bitmap text font (card field text).
- `--font-script`: a pixel monospace (script editor, message box).

The chosen families, their licenses and sources are in the design (open question 1); the candidates considered and
rejected, with reasons, are listed there too. Apple's font names (Chicago, Geneva, Monaco) appear nowhere — not in
CSS, code, comments, `FONTS.md`, the README, or the spec.

### REQ-1.2 — Committed files and attribution

For each chosen font: the font file (woff2 and/or ttf) and its license file sit together in `src/assets/fonts/`, and
`src/assets/fonts/FONTS.md` lists, per font, the family name, author/designer, license name (SIL Open Font License
1.1), and the source URL. The README font-attributions section (REQ-6) points at `FONTS.md`.

### REQ-1.3 — Native pixel sizes, no anti-alias reliance

Each font is used at a fixed pixel size at or near its native bitmap size, so anti-aliasing has no visible effect
(`retro-ui.md`: no `rem`/`em`, no attempt to force `font-smooth`). The card surface sets `image-rendering: pixelated`
on the card element. Font sizes are set per variable in `variables.css` or the component CSS, documented in the
design.

### REQ-1.4 — No network fetch

Fonts are bundled (`@font-face` `src: url(...)` to files under `src/assets/fonts/`), never loaded from a font CDN, so
the app needs no network for its look. Vite fingerprints and serves them from the build.

---

## REQ-2 — Dither patterns (`src/assets/patterns/`, `src/ui/patterns.ts`)

### REQ-2.1 — The classic 8 × 8 set

The seven classic Mac dither densities — 12.5, 25, 37.5, 50, 62.5, 75, 87.5 % — as 8 × 8 tiles in
`src/assets/patterns/`, either inline SVG (data-URL strings in a module) or 8 × 8 PNGs. Each is black-on-transparent
(or black-on-white) at hard pixel edges, usable as a `background-image` with `background-size: 8px 8px` and
`image-rendering: pixelated`.

### REQ-2.2 — One shared Bayer source

`BAYER_8` moves out of `src/ui/browse/ditherMask.ts` into a new `src/ui/patterns.ts`. Both the dissolve transition
(via `ditherMask.ts`) and the image dither (`src/ui/edit/dither.ts`) import `BAYER_8` from `src/ui/patterns.ts`.
`ditherMask.ts` re-exports nothing it no longer owns; `dither.ts`'s import path changes. No algorithm changes, so the
existing dither and transition tests keep passing unchanged.

### REQ-2.3 — Pattern tests

`src/ui/patterns.test.ts`: each density tile has exactly the expected number of black pixels in its 64-cell tile
(e.g. 50 % → 32, 12.5 % → 8, 87.5 % → 56); the densities are monotonic; `BAYER_8` is still a permutation of 0..63
with the standard first row (the assertions moved from `ditherMask.test.ts`, which now imports from `patterns.ts`).

---

## REQ-3 — Card surface (1-bit)

### REQ-3.1 — Objects

Buttons (`rect`, `roundRect`, `transparent`), fields (`rect`, `scrolling`, `transparent`), the manually drawn scroll
bar, the answer and ask dialogs, and the message box are styled per `retro-ui.md` with the new fonts: black on white,
1px borders, the button bevels already defined, `roundRect` as the single-colour rounded border from the earlier
fix, hilite as inverted fill, no anti-aliased decoration. The card surface and its children use only `#000000` and
`#ffffff`.

### REQ-3.2 — Answer / ask dialogs on the card

The `answer` and `ask` dialogs (browse-mode) are 1-bit: a white rectangle with a 1px black border on the card, the
prompt in `font-field`, buttons in the card button style, no shadow or gradient. They stay on the card surface
(they are part of the running stack), so the strict 1-bit rule applies to them, not the chrome rule.

### REQ-3.3 — HyperCard window frame

A CSS-only window frame wraps the card in the chrome (not on the card surface): a title bar showing the stack name,
with the classic horizontal lines (racing stripes) drawn with repeating `linear-gradient` or stacked 1px borders —
this is chrome, so stripes are allowed here — a 1px black outline, and the card sitting inside. No image assets. The
frame does not change the card's 512 × 342 logical size or scaling. The stack name in the title bar updates when the
stack or its name changes (it can read the picker's current label, or a small title element `main.ts` already has).

---

## REQ-4 — Chrome (System 6 desktop)

### REQ-4.1 — Palette and borders

Chrome background is light Mac gray `#f0f0f0` throughout; text `#1a1a1a`; borders flat 1px. No gradients on chrome
except the title-bar stripes; modest `box-shadow` is allowed on chrome **dialogs** only (`retro-ui.md`), never on the
card surface. The UI font is the bitmap `--font-ui`.

### REQ-4.2 — Consistent restyle

The toolbar, stack picker, New Stack / Summon / Share / Settings buttons, the mode toggle, the inspector, the script
editor frame, the message box, and the Summon, Settings and Share dialogs are restyled to one consistent System 6
look: gray surfaces, 1px borders, bitmap font, square corners (except the card's round-rect buttons). Buttons get a
classic raised-then-pressed look with 1px borders, no CSS transitions.

### REQ-4.3 — Script editor keeps its colours

The script editor's syntax-highlight token colours (script-editor spec) are unchanged; only its frame, gutter,
font and surrounding chrome adopt the new look. The editor remains readable with ≥ 4.5:1 contrast (the existing
contrast test still passes).

---

## REQ-5 — Edit mode selection

The selection outline is inflated by 2px (drawn 2px outside the object's rect) so it clears the round-rect button's
2px border and is visible on every button style, including `transparent`. The 4px × 4px handles and the 1px dashed
style are otherwise unchanged (`retro-ui.md` edit affordances). Handle positions still sit on the object's true rect
corners and edge midpoints.

---

## REQ-6 — README

Replace the `> Status: scaffolding. Nothing runs yet.` line with a one-paragraph status (what works: browse, edit,
scripts, Summon, sharing, the 1-bit look) and the live URL `https://necrocard.onrender.com`. Add a font-attributions
section listing the three families, their designers and the SIL Open Font License, pointing to
`src/assets/fonts/FONTS.md`.

---

## REQ-7 — Testing and constraints

### REQ-7.1 — CSS guard test

A Vitest test reads the card CSS (`browse.css`, and any card-surface rules elsewhere) and asserts that no rule
scoped to `.card-surface` (or its descendants) contains `linear-gradient`/`radial-gradient`, `box-shadow`, `opacity`
(as a property or in a transition), `filter`, or a system font family (`sans-serif`, `serif`, `monospace`, `Arial`,
etc.) — only `var(--font-*)`, `#000`/`#fff` colours, and the dither patterns are allowed. The per-frame transition
`mask-image`/`transform` styles are set inline by `transitions.ts`, not in CSS, so they are out of this test's scope.

### REQ-7.2 — Font-load check (unit and e2e)

`fonts.css` and `variables.css` are asserted to bind each `--font-*` variable to a bundled family, and `fonts.css`
has a matching `@font-face` with a local `src: url(...)` (no `https://fonts.`). The Playwright e2e uses
`document.fonts.check` (or `document.fonts.ready` then `check`) to confirm the card renders with the loaded field and
UI fonts, not a fallback.

### REQ-7.3 — Reference screenshot

The Playwright e2e takes a screenshot of the quiz title card at 2× scale and commits it as the visual reference
under `test/e2e/` or `docs/screenshots/` (open question 6). Later visual regressions are judged against it by eye;
this spec does not add pixel-diff assertions (no new dependency).

### REQ-7.4 — Playwright MCP

One run against the dev server, one dependent action per call with a `browser_evaluate` state check before each
screenshot: the quiz title card, a scrolling field (a card that has one, or a field made to overflow), an answer
dialog (trigger a button whose script calls `answer`), and the Edit-mode inspector. Screenshots to
`.playwright-mcp/` (`retro-title.png`, `retro-scrolling.png`, `retro-answer.png`, `retro-inspector.png`).

### REQ-7.5 — Constraints

No change to `src/interp/`, `src/model/`, `src/summon/`, `src/share/` or `server/`. No new dependencies. Every
existing test stays green (this is a visual change; DOM structure and class names stay stable, or tests are updated
only where a class name genuinely changed). Files stay under ~300 lines. The card surface stays exactly 512 × 342
logical pixels.
