---
inclusion: fileMatch
fileMatchPattern: "{src/ui/**,**/*.css}"
---

# NecroCard — Retro UI Steering

This file is active whenever you work on files under `src/ui/` or any `.css` file. It defines the 1-bit
Macintosh visual rules, font choices, rendering constraints, and CSS conventions for NecroCard.

## The prime directive

The card surface is sacred. Everything rendered inside the 512 × 342 card area must look like it came off a
1984 Macintosh screen: 1-bit black and white, hard pixel edges, no anti-aliasing, no gradients, no box
shadows, no blur filters, no opacity transitions on card content.

## 1-bit rendering rules

- **No anti-aliasing** on the card surface. Set `image-rendering: pixelated` on the card canvas/element.
- **No gradients** inside the card. Use dither patterns (see below) for fills instead.
- **No box shadows or drop shadows** on card objects. Bevel is achieved with 1px light/dark border pairs.
- **No `opacity` transitions** on card content. Card-to-card transitions are stepped DOM effects (see
  Visual transitions below), never smooth fades.
- **No `border-radius`** on card objects except `button` with style `roundRect`, which uses a fixed 8px
  radius rendered to match the original Mac look.
- Colors on the card surface: `#000000` (black) and `#ffffff` (white) only. No grays, no colour.

## Dither patterns

- Fill patterns must come from the classic Mac 8×8 dither set: 12.5%, 25%, 37.5%, 50%, 62.5%, 75%, 87.5%.
- Patterns are defined as small PNGs or inline SVG `<pattern>` elements in `src/assets/patterns/`.
- Apply them via `background-image` with `background-size: 8px 8px` and `image-rendering: pixelated`.
- Do not simulate dither with CSS `opacity` on a solid color.

## Typography

- **UI chrome** (menus, inspector, toolbar): classic Mac-style bitmap font for UI. Use the web font from
  `src/assets/fonts/`. Class: `font-ui`.
- **Card field text**: classic Mac-style proportional bitmap font from `src/assets/fonts/`. Class: `font-field`.
- **Script editor**: classic Mac-style monospace bitmap font. Class: `font-script`.
- All three fonts must be loaded via `@font-face` in `src/assets/fonts/fonts.css`.
- **Fonts must be open-licensed lookalikes** (OFL, CC, or similar). The license file for each font must be
  committed alongside the font files in `src/assets/fonts/`. Do not name or use Apple's proprietary fonts
  (Chicago, Geneva, Monaco are off-limits); refer to them only as "classic Mac-style bitmap fonts".
- Do not use system fonts for card or UI rendering. Do not use any variable font.
- Font sizes are fixed in pixels, not `rem` or `em`.
- Font anti-aliasing cannot be fully disabled cross-platform. Use bitmap-style fonts at their native pixel
  size so that anti-aliasing has no visible effect — do not attempt to force `font-smooth: never` or
  `-webkit-font-smoothing: none` as a cross-browser guarantee.

## Card dimensions and scaling

```css
/* Canonical card size — never change these values */
--card-width: 512px;
--card-height: 342px;
```

The card is scaled with `transform: scale()` to fit the viewport. The logical pixel grid is always 512 × 342.
Do not use percentage widths or viewport units on the card element itself.

## CSS conventions

- All CSS class names use **kebab-case**: `card-surface`, `button-rect`, `field-scrolling`.
- State variants use BEM-style modifiers: `button--selected`, `card--active`.
- No CSS-in-JS. No `style` attributes on elements except:
  - dynamic `rect` positioning (x, y, w, h);
  - per-frame transition styles set by the transition engine on the card layers: `mask-image`
    (and its `-webkit-` form, with `mask-size` / `mask-repeat`), `clip-path`, and `transform`,
    removed when the transition ends;
  - the scroll thumb's `top` in a scrolling field's scroll bar.
- Dynamic position and size are applied as inline `style` with `left`, `top`, `width`, `height` in `px`.
- Use CSS custom properties (variables) for the palette, card dimensions, and font stacks. Define them on
  `:root` in a dedicated `src/ui/variables.css`.
- Do not use `z-index` values above 100 except for modal dialogs (max 1000).

## Chrome vs. card surface

The chrome around the card (menus, inspector, toolbar) may use a quiet dark theme or the same 1-bit style.
Keep it visually subordinate to the card. Rules:

- Chrome background: `#1a1a1a` (dark) or `#f0f0f0` (light Mac gray) — pick one and be consistent.
- Chrome may use subtle gray tones and modest shadows; the strict 1-bit rule applies to the card only.
- Never let chrome styles bleed into the card surface via inheritance. The `.card-surface` element must
  reset all inherited color, background, and font properties to the 1-bit defaults.

## Visual transitions

Cards are DOM. Transitions between cards are stepped DOM effects, not canvas rasterization. The four supported effects:

| Effect | Implementation |
|---|---|
| `dissolve` | Animated 1-bit dither `mask-image` sequence, ~10–12 discrete frames |
| `wipe left` | New card revealed from right via `clip-path` in discrete steps |
| `wipe right` | New card revealed from left via `clip-path` in discrete steps |
| `scroll up` | Old card translates up via `transform` in discrete steps while new card follows |

- Transition duration: 333 ms over ~10–12 frames. Do not make this a CSS variable; keep it in the
  transition engine constant (`TRANSITION_DURATION_MS = 333`).
- Steps are driven by `requestAnimationFrame` or a fixed-interval timer — not CSS `transition` or
  `animation` easing curves.
- Do not use smooth `opacity` fades or eased CSS animations for card-to-card navigation.
- A canvas overlay is allowed only if it does not require rasterizing the DOM card (e.g., for the dissolve
  dither mask generation). Do not read back pixel data from the live card DOM.

## Buttons

| Style | Appearance |
|---|---|
| `rect` | 1px black border, white fill, 1px bevel (top/left white, bottom/right black) |
| `roundRect` | 8px border-radius, same bevel treatment, slightly heavier border |
| `transparent` | No border, no fill; label text only |

- Default button label font: `font-ui`, centered, black on white.
- Highlighted state (`autoHilite`): invert fill (black background, white text). No CSS transitions.
- Render buttons as real `<button>` elements with all user-agent styles reset (`appearance: none; all: unset`
  or equivalent). Do not use `<div>` for interactive buttons — real `<button>` elements are required so the
  accessibility rules in this file hold without extra ARIA work.

## Fields

| Style | Appearance |
|---|---|
| `rect` | 1px black border, white fill, no scroll bar unless content overflows |
| `scrolling` | 1px black border, classic Mac scroll bar on the right (drawn manually, not browser default) |
| `transparent` | No border, no fill |

- Field text uses `font-field`. Line height: 1.2 in field pixels.
- `lockText` fields do not show a cursor or accept focus.
- Do not use `<textarea>` default styling; reset all UA styles.

## Edit mode affordances

- Selection handles: 4px × 4px solid black squares at the 8 corners and edge midpoints.
- Selection outline: 1px dashed black, 4px dash, 4px gap.
- Drag ghost: 50% opacity copy of the object (this is the one allowed opacity exception in edit mode, not
  on the browse card surface).
- Inspector panel: chrome styling (not 1-bit card rules), fixed width 240px, positioned to the right of
  the card.

## Accessibility

- All interactive card objects must have an accessible name (button label, field name, or `aria-label`).
- The card surface must have `role="application"` and `aria-label="HyperCard stack"`.
- Focus ring in edit mode: use the selection handle style above rather than the browser default.
- Do not remove focus outlines in browse mode without providing an equivalent visible indicator.

## What not to do (summary)

- No Tailwind, Bootstrap, or any CSS utility framework.
- No CSS modules, CSS-in-JS, or styled-components.
- No gradients, shadows, blurs, or opacity effects on the card surface.
- No system fonts on the card or in the UI chrome.
- No CSS transitions for card navigation — DOM stepped effects only, no canvas rasterization of the card.
- No `!important` except to reset UA stylesheet defaults.
