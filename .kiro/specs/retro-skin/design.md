# retro-skin — Design

## File map

```
src/assets/fonts/
├── fonts.css                 # @font-face for the three families, bound to --font-ui/field/script
├── Silkscreen-Regular.woff2  # + Silkscreen-Bold.woff2
├── Silkscreen-OFL.txt
├── DotGothic16-Regular.woff2
├── DotGothic16-OFL.txt
├── VT323-Regular.woff2
├── VT323-OFL.txt
└── FONTS.md                  # name, designer, licence, source URL per font
src/assets/patterns/
├── dither-12-5.svg … dither-87-5.svg   # the seven classic 8×8 tiles, one file each (generated; a test pins them)
src/ui/
├── patterns.ts               # BAYER_8 (moved here) + density→tile helpers; imported by ditherMask.ts and edit/dither.ts
├── patterns.test.ts          # pixel-count-per-density + BAYER_8 permutation (moved from ditherMask.test.ts)
├── variables.css             # --font-* now point at the bundled families; font-size tokens
├── chrome.css                # System 6 chrome: toolbar, push buttons, status line, message box, and the HyperCard
│                             # window frame (.card-window, title bar with stripes) around the card
└── <existing browse/edit/script-editor/summon/share CSS, restyled>
```

Imports: `src/assets/fonts/fonts.css` and the pattern module live under `src/assets/` which `structure.md` already
allows. `src/ui/patterns.ts` imports nothing from `src/` (pure data). `ditherMask.ts` and `src/ui/edit/dither.ts`
import `BAYER_8` from `../patterns.js` / `../patterns.js`. No change to any non-CSS file outside `src/ui/`.

---

## Fonts

### Chosen (all SIL Open Font License 1.1, verified against the google/fonts repo METADATA on 2026-11-04)

| Variable | Family | Designer | Why | Source |
|---|---|---|---|---|
| `--font-ui` | **Silkscreen** | Jason Kottke | A chunky 5–7px bitmap face with a Bold weight, the closest open face to a heavy classic-Mac system font for menus and buttons; crisp at ~8px. | github.com/googlefonts/silkscreen |
| `--font-field` | **DotGothic16** | Fontworks Inc. | A proportional dot-matrix face that reads as body text at 12–16px, standing in for the proportional classic-Mac text font without looking like a terminal. | github.com/fontworks-fonts/DotGothic16 |
| `--font-script` | **VT323** | Peter Hull | A single-weight terminal monospace; every glyph is one cell, ideal for the code editor and message box at 16px. | github.com/phoikoi/VT323 |

Font sizes (each font at its native pixel size, so anti-aliasing has no visible effect; confirmed):
- **NecroField (DotGothic16)** is a 16-pixel font: card field text is 16px with line-height 20px, never 12px. The
  three fixtures' fields are checked at that size in Task 3; any that overflow get a larger rect (reported).
  Chrome body text (toolbar buttons, picker, inspector labels, dialog prose) is also NecroField 16px, because
  Silkscreen at 8px is unreadable unscaled and has no true lowercase.
- **NecroUI (Silkscreen)** is 8px Regular on card buttons (the card's 2× scale makes it 16 screen pixels), and 16px
  Bold for the window title, the app name and dialog titles only.
- **NecroScript (VT323)** is 16px with line-height 20px for the script editor and message box, applied through the
  shared code-metrics class so the mirror, textarea and gutter stay aligned.
- Answer and ask dialogs: prompt NecroField 16px, buttons styled like card buttons (NecroUI 8px).
These are fixed px, per `retro-ui.md` (whose typography section gains one sentence saying so).

### Candidates rejected (with reasons)

- **Jersey 10 / Jersey 15** (OFL, Sarah Cadigan-Fried): a sports-jersey block face; handsome but reads as athletic
  numerals, not a Mac system font, and Jersey 10's ultra-condensed body is hard to read as UI text.
- **Pixelify Sans** (OFL): a rounded, friendly pixel sans with a modern feel; too soft and contemporary for a 1984
  System look.
- **Tiny5** (OFL): a 5px micro font; wonderful but too small to carry card field text or dialog prose legibly inside
  512 × 342, and it has no bold for the UI.
- **Workbench** (OFL): a variable "dot-matrix with distortion" display face; its variable axes and distortion run
  against the fixed-native-size rule and the flat 1-bit look.
- **DotGothic16** was kept over the others for field text specifically because it is proportional (not monospace) and
  has real lowercase body rhythm; **VT323** was kept for the editor because a code font must be monospaced.

The three chosen cover the three required roles (bold UI, proportional text, monospace) with one face each; no role
is left on a system fallback. woff2 is generated from the repo ttf with the build's own tooling or committed from the
Google Fonts download (open question 3: woff2 only, or woff2 + ttf fallback — default woff2 only, with the ttf kept
if any target lacks woff2, which none do).

### fonts.css

```css
@font-face { font-family: "NecroUI"; src: url("./Silkscreen-Regular.woff2") format("woff2"); font-weight: 400; font-display: block; }
@font-face { font-family: "NecroUI"; src: url("./Silkscreen-Bold.woff2") format("woff2"); font-weight: 700; font-display: block; }
@font-face { font-family: "NecroField"; src: url("./DotGothic16-Regular.woff2") format("woff2"); font-display: block; }
@font-face { font-family: "NecroScript"; src: url("./VT323-Regular.woff2") format("woff2"); font-display: block; }
```

Internal family aliases (`NecroUI`, `NecroField`, `NecroScript`) keep the real family names out of the DOM's computed
style churn and make the "no Apple names" rule trivially true. `font-display: block` avoids a flash of a system font
on the card. `main.ts` (or `index.html`) imports `fonts.css` first. `variables.css`:

```css
--font-ui: "NecroUI", monospace;      /* monospace fallback only until the bundled face loads */
--font-field: "NecroField", monospace;
--font-script: "NecroScript", monospace;
```

(The fallback is a generic the CSS guard test allows outside `.card-surface`; inside the card the test requires the
`var(--font-*)` form, which resolves to the bundled face — see REQ-7.1 note below.)

---

## Patterns

`src/ui/patterns.ts`:

```ts
export const BAYER_8: readonly number[];                 // moved verbatim from ditherMask.ts
export const DITHER_DENSITIES = [12.5, 25, 37.5, 50, 62.5, 75, 87.5] as const;
export function ditherTileSvg(percent: number): string;  // 8×8, black cells where BAYER_8[i] < round(percent/100*64)
export function ditherTileUrl(percent: number): string;  // url("data:image/svg+xml,...")
export function ditherCellCount(percent: number): number; // round(percent/100*64) — the black-cell count
```

The density tile reuses the Bayer order already used by the dissolve mask, so a 50 % fill and a half-done dissolve
share the same pattern — one visual language. `ditherMask.ts` keeps `maskCoverage`/`ditherMaskSvg`/`ditherMaskUrl`
but imports `BAYER_8` from `../patterns.js`; `src/ui/edit/dither.ts` changes its import to `../patterns.js`.

The seven tiles are exposed as CSS custom properties or utility classes (e.g. `.dither-50`) for fills the chrome or
card wants (the image placeholder already uses a 50 % look; it can switch to `ditherTileUrl(50)`).

`patterns.test.ts`: `ditherCellCount(p)` equals the documented count for each density; `ditherTileSvg(p)` contains
exactly that many `<rect>`s; densities strictly increase; `BAYER_8` is a permutation of 0..63 with first row
`[0,32,8,40,2,34,10,42]`.

---

## Card surface

All card CSS stays scoped under `.card-surface`. Changes are font and colour only; no structural DOM change, so
browse/edit/script-editor tests that query classes keep passing. Specifics:
- Buttons: `--font-ui` (or `--font-field` for the label? open question 4 — default `--font-ui`), the existing bevels
  and the single-colour round-rect border; hilite inverts to black fill / white text.
- Fields: `--font-field`, 12px, line-height 1.2; `rect`/`scrolling` 1px black border; the scroll bar keeps its
  hand-drawn arrows and gets a 50 % dither thumb track (`ditherTileUrl(50)`) for the classic look.
- answer/ask dialogs: a `.card-dialog` white box, 1px black border, `font-field` prompt, card-style buttons, no
  shadow. (These already exist from browse-mode; this only restyles them.)
- message box: `--font-script`, already highlighted; the wrap gets a 1px top border only.

### Window frame (in `chrome.css`; the stage builds it)

```
.card-window           -> inline-block, 1px solid #000, background #fff, around the frame + card
.card-window-title     -> height ~18px, font-ui, centered stack name, racing stripes via
                          repeating-linear-gradient(#000 0 1px, transparent 1px 2px) left and right of the label
.card-window-title-label-> #fff background, a few px padding, so the label sits in a gap in the stripes
```

The stripes are chrome, so the gradient is allowed (the guard test only forbids gradients inside `.card-surface`).
`main.ts` wraps `stage.viewport` in `.card-window` with a title element whose text follows the current stack name
(it already tracks `current`/`picker`); the title updates in `loadStack`/`loadKey`/`showCustom` paths via a small
`setCardTitle(name)` helper, or by reading `picker` label. Default: a `setCardTitle` call added where the picker
label is set (open question 5).

---

## Chrome

`chrome.css` and the dialog CSS move to the System 6 look:
- surfaces `#f0f0f0`, text `#1a1a1a`, 1px `#808080`/`#000` borders, square corners.
- toolbar buttons: `.chrome-button` gets a 1px outset look (top/left light `#fff`, bottom/right dark `#808080`) and
  an inset look on `:active`; no transitions.
- dialogs (`.summon-dialog` and friends): keep the modest `box-shadow` they have (allowed on chrome dialogs), gain
  the gray surface and bitmap font.
- the inspector: gray panel, `font-ui` labels, 1px field borders.
- the script editor frame and gutter: gray, `font-script` for the code, token colours unchanged.

All chrome font sizes are fixed px. Buttons and labels use `--font-ui`; the font is small, so the design notes the
chosen px sizes and checks the toolbar still fits on one row at the default window width.

---

## Edit selection (REQ-5)

In `edit.css` / the overlay, the selection outline rectangle is drawn at `rect` inflated by 2px on every side
(`left-2, top-2, width+4, height+4`), so a 2px round-rect border never hides it. The handles keep their positions on
the true rect (the overlay computes handle coordinates from the object rect, not the outline), so only the outline
box grows. If the inflation is a CSS `outline`/`box-shadow`-free border on the overlay element, it is a 1px dashed
border on a box 2px larger; the overlay is chrome-side (edit affordance), not card content, so the dashed border is
fine.

---

## Testing

| File | Env | Covers |
|---|---|---|
| `src/ui/patterns.test.ts` | node | density pixel counts, monotonic, BAYER_8 permutation + first row |
| `src/ui/cardSurface.test.ts` | node | REQ-7.1 guard: no gradient/shadow/opacity/filter/system-font in `.card-surface` rules |
| `src/ui/fonts.test.ts` | node | `fonts.css` has three `@font-face` with local `url(...)` and no `https://fonts.`; `variables.css` binds each `--font-*` to a `Necro*` family |
| existing `ditherMask.test.ts`, `dither.test.ts` | — | unchanged results after the import move |
| `test/e2e/retro-skin.spec.ts` | Playwright | `document.fonts.ready` then `document.fonts.check('12px "NecroField"')` true; the card computed `font-family` resolves to a `Necro*` family; 2× title-card reference screenshot committed |

The CSS guard parses `browse.css` (and any file with `.card-surface` rules) with a small regex/brace scan: for each
block whose selector contains `.card-surface`, assert the body matches none of the forbidden tokens. `var(--font-*)`
is allowed; a bare `sans-serif`/`serif`/`monospace` inside such a block fails. This is a lint-grade string check, not
a full CSS parser (open question 7).

---

## Open questions (defaults chosen; confirm or override)

1. **Fonts.** `--font-ui` = **Silkscreen** (Jason Kottke, OFL), `--font-field` = **DotGothic16** (Fontworks Inc.,
   OFL), `--font-script` = **VT323** (Peter Hull, OFL). All three are SIL Open Font License 1.1, confirmed from the
   google/fonts repo METADATA with downloadable files and named designers. Sources: github.com/googlefonts/silkscreen,
   github.com/fontworks-fonts/DotGothic16, github.com/phoikoi/VT323. Swap any one if it reads wrong at native size
   inside the card — the rejected list (Jersey 10/15, Pixelify Sans, Tiny5, Workbench) are the fallbacks.
2. **UI font size.** Answered: NecroUI 8px Regular on card buttons, 16px Bold for titles only; everything else
   (chrome body, toolbar buttons, picker, inspector labels, dialog prose) is NecroField 16px.
3. **Font file formats.** woff2 only. DotGothic16 ships as its **Latin subset** (the full file covers Japanese and is
   over a megabyte); `FONTS.md` records the subset, that the OFL permits it, and each font's Reserved Font Name status.
4. **Button label font.** `--font-ui` on card buttons; the field font (`--font-field`, 16px) on chrome buttons.
5. **Card title source.** A `setCardTitle(name)` helper in `main.ts` called wherever the picker label changes, so the
   window title always matches the open stack. Default: add it; it reads the same name the picker shows.
6. **Reference screenshot location.** `docs/screenshots/retro-title-2x.png`, with the other committed shots.
7. **CSS guard strictness.** A string/brace scan of `.card-surface` blocks, not a full parser. It can miss a token
   split oddly across lines; the risk is low because the card CSS is hand-written and small. Default: the scan.
8. **Patterns as SVG vs PNG.** Seven small `.svg` files in `src/assets/patterns/` (`dither-50.svg` already existed and
   `browse.css` already referenced it, so it had been a real file all along), each byte-for-byte what
   `ditherTileSvg(p)` generates; `patterns.test.ts` fails if one drifts. No binary files. Default SVG.
9. **`image-rendering: pixelated`.** On the `.card-surface` element and card `<img>`s. Fonts are unaffected (it is
   for raster scaling), but the dither tiles and imported images stay crisp when the card is scaled. Default: on.
10. **Internal font family names.** Alias the three faces as `NecroUI` / `NecroField` / `NecroScript` in `@font-face`,
    so the real (non-Apple, but still third-party) family names do not appear in the DOM and the "no Apple names"
    rule is obviously satisfied. The real names and licences live in `FONTS.md`. Default: alias.
