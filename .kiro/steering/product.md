# NecroCard — Product Steering

## What NecroCard is

NecroCard is HyperCard in the browser, with an agent that builds a working stack from a plain-English description.
Tagline: **HyperCard, raised from the dead.**
Hackathon: Kiroween 2026, category Resurrection. Deadline Dec 4, 2026, 2:00 PM PT.

## Core model — keep faithful to HyperCard

The object model is fixed. Do not add new object types or properties beyond those listed below without explicit
approval.

| Concept | Details |
|---|---|
| **Stack** | name, list of backgrounds, list of cards, stack script, metadata (created, modified, author) |
| **Background** | shared objects and script for cards that use it |
| **Card** | belongs to one background; has its own objects and script |
| **Button** | style (`rect`, `roundRect`, `transparent`), label, autoHilite |
| **Field** | text, lockText, style (`rect`, `scrolling`, `transparent`) |
| **Image** | src (data URL or asset id), 1-bit dithered on import |

Common object properties: `id`, `name`, `rect` (x, y, w, h), `visible`, `script`.
Object ids are short random URL-safe strings (8–10 characters); names are user-facing strings used by scripts (`field "Name"`).
The whole stack serializes to one JSON document. **Round-trip must be lossless.**

## HyperCard fidelity rules

- Cards render at **512 × 342 logical pixels** (original Mac resolution), scaled to fit the viewport.
- The card surface is **sacred**: 1-bit, no anti-aliasing, no gradients, no shadows on card content.
- Visual transitions (dissolve, wipe left/right, scroll up) are stepped DOM effects — wipe and scroll via `clip-path` or `transform` in discrete steps, dissolve via an animated 1-bit dither `mask-image` sequence (~10–12 frames over 333 ms). No smooth opacity fades, no eased CSS animations, no requirement to rasterize the card to a canvas.
- The message-passing order is fixed: object → card → background → stack. Never deviate from this.
- The script language is NecroTalk (see `necrotalk.md`). `eval` is forbidden. Only the frozen grammar subset is in scope.

## Audiences

- People who want a small interactive thing (quiz, CYOA, flashcard deck, tiny tool, interactive zine) without a framework.
- Teachers and tinkerers who remember HyperCard and want the feeling back with modern sharing.
- Anyone curious what "describe it and it exists" looks like when the output is editable, inspectable software.

## Summon (AI authoring)

- Input: plain-English paragraph. Output: valid stack JSON with scripts that parse under NecroTalk.
- Pipeline: prompt with schema + grammar → request JSON → validate → parse every script → retry once with error list → load.
- "Explain this script" and "Fix this script" actions are available from the script editor.
- A small serverless function handles requests with a hard daily cap and per-IP limit.
- Bring-your-own-key option stored only in the browser (never on the server).
- The demo URL must stay free through **Jan 29, 2027**.
- Ships with 3–4 sample stacks so the app works without any AI calls.

## Persistence and sharing

- Autosave the open stack to `localStorage`.
- Export and import `.necrocard.json`.
- Share by URL: compressed stack in the fragment for small stacks; serverless blob store with a short id for larger ones.

## Non-goals (do not implement during the hackathon)

- Importing real HyperCard `.stack` files.
- Full HyperTalk compatibility.
- Paint tools, sound recording, printing, multi-user editing, accounts.
- Mobile editing (mobile browse mode is a nice-to-have, not required).
- NecroTalk Phase 2 features (`item` chunks, `find`, `play`, `send`) until specs 1–7 are done.

## Milestones

| Week | Target |
|---|---|
| Nov 3–9 | Steering docs. Specs: stack model, NecroTalk interpreter. Model, serialization, browse mode, navigation, parser with PBT |
| Nov 10–16 | Interpreter execution, message passing, dialogs, visual effects. Edit mode, inspector, script editor. Hooks live |
| Nov 17–23 | Summon, explain/fix, sample stacks, sharing, 1-bit polish, deploy to final URL |
| Nov 24–Dec 3 | Freeze. Bugs, README, write-up, blog post, social post, video. Submit Dec 3 with a one-day margin |
