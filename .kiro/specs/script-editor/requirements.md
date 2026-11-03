# script-editor — Requirements

## Overview

Replace the plain script textarea from `edit-mode` with a real NecroTalk editor, built without new dependencies:
syntax highlighting from the interpreter's own tokenizer, a line-number gutter, inline parse errors, keyboard
indent/outdent, and Explain/Fix actions that go through an agent interface. The message box gains the same
highlighting and a line history.

This is spec 5 of 8. It builds on `necrotalk-interpreter` (`tokenize`, `KEYWORDS`, `parse`, `NecroTalkError`),
`browse-mode` (message box, status line) and `edit-mode` (inspector, `ScriptEditorSlot`, `setScript` commands,
undo history).

Sources: `docs/BRIEF.md` section 5 (script editor, message box); steering `structure.md` (spec-to-folder
mapping: `src/ui/script-editor/`) and `retro-ui.md` (chrome vs. card surface, `font-script`, accessibility).

### In scope

Highlighted script editor with gutter and inline errors; indent/outdent; Explain and Fix with an `AgentClient`
interface and a stub client; a line diff view with Apply/Cancel; an Expand dialog; message box highlighting and
history; Vitest unit and property tests; Playwright e2e; one Playwright MCP verification run.

### Out of scope

The real agent client, prompts, network calls, keys and caps (spec `summon`); autocomplete, bracket matching,
search/replace, folding, multiple cursors; highlighting in non-script fields; persisting message box history;
any change to `src/interp/` or `src/model/`; new dependencies.

---

## REQ-1 — Highlighting

### REQ-1.1 — The tokenizer is the source of truth

Highlighting uses `tokenize` and `KEYWORDS` from `src/interp/tokenizer.ts`. There is no second lexer: token kinds,
keyword membership and token boundaries all come from the tokenizer's output. The only text the editor classifies
itself is text the tokenizer *skips*, and the tokenizer skips exactly two things: whitespace (space, tab, CR) and
`--` comments to end of line. So inside a gap between tokens, everything from the first non-whitespace character to
the end of the gap is a comment (open question 1).

### REQ-1.2 — Per-line tokenization

Tokens never span lines (string literals stop at a newline; comments end at one), so each line is tokenized
separately. A line the tokenizer rejects (unterminated string, unexpected character) is shown as one `invalid` span
and does not affect the highlighting of other lines (open question 2).

### REQ-1.3 — Span kinds

| Kind | Source |
|---|---|
| `keyword` | a `keyword` token |
| `handler` | an `identifier` token that directly follows the keyword `on`, `end`, `exit` or `pass` on the same line |
| `identifier` | any other `identifier` token |
| `string` | a `string` token, including both quotes |
| `number` | a `number` token |
| `operator` | an `operator` token |
| `punctuation` | a `punctuation` token |
| `comment` | gap text from the first non-whitespace character (always `--`) to the end of the gap |
| `space` | whitespace in a gap |
| `invalid` | a whole line the tokenizer rejects |

Each token's source text is sliced from the line using its `column` (1-based): a string token covers
`value.length + 2` characters, every other token `value.length` characters. Source text is always taken from the
line, never from `value` (keywords are lowercased in `value`).

### REQ-1.4 — Exact reproduction

For every input string, concatenating the text of all spans of all lines, joined with `\n`, reproduces the input
exactly, character for character (including CR, tabs, trailing spaces, empty lines and non-ASCII text).

### REQ-1.5 — Rendering

The editor's `<textarea>` stays the real, focusable, editable control. A mirror `<pre aria-hidden="true">` behind it
shows the spans as `<span class="tok-<kind>">` elements, built with `textContent` only (never `innerHTML`). The
textarea's text is transparent (caret and selection stay visible); the mirror uses identical font, size, line
height, padding, `tab-size` and `white-space: pre`, and follows the textarea's `scrollTop`/`scrollLeft`. Highlighting
updates synchronously on every `input` event.

Colours follow the chrome rules (not the card's 1-bit rules) and are distinguishable without relying on colour
alone for errors (REQ-3). Styles change colour only — no bold or italic — so glyph widths match the transparent
textarea text exactly (open question 3).

---

## REQ-2 — Gutter

- A line-number gutter to the left of the text, `aria-hidden="true"`, one number per line starting at 1, right
  aligned, wide enough for the largest number.
- It scrolls vertically with the textarea and updates on every `input`.
- The line with the current error (REQ-3) shows a `!` marker next to its number (not only a colour).

---

## REQ-3 — Inline errors

- 300 ms after the last `input` (debounced), and immediately on `set`, the editor parses the whole text with
  `parse`. An empty or whitespace-only script has no error.
- On a `NecroTalkError`, the error's line (clamped to `[1, line count]`) gets the `script-line--error` class in the
  mirror (a wavy underline under that line's text) and the `!` gutter marker. The error message (e.g.
  `Line 3: Expected "end mouseUp" but found "end mouseDown".`) is shown directly below the editor in a status region
  (`role="status"`, `aria-live="polite"`) that the textarea references with `aria-describedby`, and the textarea gets
  `aria-invalid="true"`.
- With no error the region shows `No errors` and `aria-invalid` is removed.
- Only the first error is shown (the parser stops at the first error).
- Errors never block a commit; browse mode reports them when the script runs (as in `edit-mode`).
- Other exceptions from `parse` show their message without a line marker.

---

## REQ-4 — Indent and outdent

- Ctrl+] (⌘] on macOS) indents and Ctrl+[ (⌘[) outdents every line touched by the selection, or the caret's line
  when nothing is selected. Indent adds two spaces at the start of each line; outdent removes up to two leading
  spaces (or one leading tab) from each line.
- The selection is preserved across the change, shifted by the inserted or removed characters on its first and last
  lines.
- The edit uses the browser's text-insertion path so the textarea's native undo (Ctrl+Z inside the textarea) can
  undo it, falling back to `setRangeText` where that is unavailable (open question 4).
- Tab and Shift+Tab are never intercepted; they keep moving focus.

---

## REQ-5 — Explain and Fix

### REQ-5.1 — Agent interface (`src/summon/agentClient.ts`)

The interface, `ScriptContext`, `AgentUnavailableError` and the stub client live together in
`src/summon/agentClient.ts`, a public module of `src/summon/`. Per `structure.md`, `src/ui/` may import it and
`src/summon/` never imports `src/ui/`. Spec `summon` adds the real client next to the stub.

```ts
export interface ScriptContext {
  owner: { type: 'button' | 'field' | 'image' | 'card' | 'background' | 'stack'; name: string };
  stackName: string;
  cardName: string | null;        // the card being edited (null for background and stack scripts)
  backgroundName: string | null;
  /** Names of the objects on the current card and its background, so a fix can refer to them. */
  objectNames: { type: 'button' | 'field' | 'image'; name: string }[];
}

export interface AgentClient {
  explain(script: string, context: ScriptContext, signal?: AbortSignal): Promise<string>;
  fix(script: string, error: string | null, context: ScriptContext, signal?: AbortSignal): Promise<string>;
}

export class AgentUnavailableError extends Error {}
```

`explain` resolves with a plain-English explanation; `fix` resolves with a complete replacement script. Both may
reject; `AgentUnavailableError` means no agent is configured.

### REQ-5.2 — Stub client

`createStubAgentClient()`, exported from `src/summon/agentClient.ts`, rejects both calls with
`AgentUnavailableError('Summon is not configured')`. It makes no network request. The app uses it until spec
`summon` provides the real client in `src/summon/`; the client is injected, so swapping it changes one line in
`src/main.ts`.

### REQ-5.3 — Buttons

Under each script editor: "Explain" and "Fix" buttons (chrome styling).

- While a request is pending, both buttons are disabled, the editor is read-only, the region shows
  `Asking Summon…`, and a "Cancel" button aborts the request through its `AbortSignal`.
- A rejection shows its message in the app status line (the stub: `Summon is not configured`) and restores the
  editor.
- Explain's result is shown in a read-only explanation panel under the editor (text only, `textContent`) with a
  "Close" button.
- Fix sends the current text and the current inline error message (or `null` when there is none, open question 7).

### REQ-5.4 — Fix diff view

When `fix` resolves, the editor is replaced (while open) by a diff view of the current script (old) against the
proposed one (new):

- a line-by-line diff computed in-house (longest common subsequence over lines, no library);
- each row shows the old line number, the new line number, a text marker (`−` removed, `+` added, a space for
  unchanged) and the line text — so changes are clear without colour;
- an "Apply" and a "Cancel" button. Escape cancels. Focus moves to the diff's heading when it opens and back to the
  editor when it closes;
- if the proposal equals the current script, the view says `No changes proposed` and only Cancel is offered.

Apply replaces the script and commits it immediately as **one** undoable `setScript` command (the `edit-mode`
history), so Ctrl+Z outside a text control restores the previous script in one step. Cancel changes nothing.

### REQ-5.5 — Expand

An "Expand" button under each script editor (next to Explain and Fix) opens a chrome `<dialog>` (`showModal`, about
640 px wide, labelled `Script of <owner type> "<owner name>"`, e.g. `Script of button "BeginButton"`, computed when it
opens) in which the editor shows 24 rows.

- The dialog contains **the same editor element**, moved into it — not a second editor. On Close (a "Close" button
  in the dialog) or Escape it is moved back to its original place in the inspector. Text, selection, scroll
  position, highlighting, the current inline error, a pending Explain/Fix request, an open diff view or explanation
  panel, and the commit rules are therefore unchanged by expanding or collapsing.
- Close and Escape commit nothing by themselves. The normal rules apply: the textarea's `change` (blur) commits, and
  the inspector's `flush` before any other operation commits, exactly as when the editor is in the inspector.
- Focus moves to the textarea when the dialog opens and back to the Expand button when it closes.
- While expanded, the Expand button reads "Expanded" and is disabled. Edit-mode keyboard shortcuts on the card are
  inactive while the dialog is open (as for every open `<dialog>`).
- If the inspector rebuilds while the dialog is open (selection change through undo, stack load), the dialog closes
  first and the editor is moved back before the old slot is discarded.

---

## REQ-6 — The edit-mode slot

`src/ui/edit/scriptSlot.ts` replaces `createPlainScriptSlot` with `createScriptSlot(label, deps)` returning the same
`ScriptEditorSlot` interface (`el`, `set`, `onCommit`, `commit`, `focus`, `hasFocus`), so the inspector's commit
rules are unchanged: text commits on `change` (blur) and on `flush`; Apply commits at once. `deps` supplies the
`AgentClient`, a `context()` function for the slot's owner, and the app status line. `parseStatus` is removed in
favour of the editor's error detection.

---

## REQ-7 — Message box

- The message box keeps its single-line `<input>` (accessible name "Message box") and gains the same highlighting:
  a mirror behind the transparent input text, following its horizontal scroll.
- History of submitted lines, most recent last, at most 50; empty lines are not stored; a line equal to the most
  recent entry is not stored again.
- Up shows the previous entry, Down the next; Down past the newest restores the text the user was typing before
  they started browsing history. The caret moves to the end of the recalled line.
- History is kept in memory for the page session, across stack loads (HyperCard's message box is global), and is
  not persisted (open question 10).
- Enter, the disabled state in edit mode and while busy, and error reporting stay as in `browse-mode`.

---

## REQ-8 — Styling and accessibility

- Everything in this spec is chrome: chrome palette, `font-script` for code, never the card's 1-bit rules, never
  inherited by `.card-surface`.
- The textarea and input remain the controls screen readers use; mirrors and gutter are `aria-hidden`.
- Every button has a visible text label; the diff view and explanation panel are labelled regions.
- Colour contrast of every token colour on the editor background is at least 4.5:1.

---

## REQ-9 — Testing

### REQ-9.1 — Unit tests (Vitest)

- `highlight.test.ts`: one example per span kind; `handler` after `on`, `end`, `exit`, `pass`; keyword case kept
  from the source; strings with their quotes; comments after code and on their own line; CRLF; a rejected line
  becomes one `invalid` span while other lines stay highlighted.
- `errors.test.ts`: error line mapping for parser and tokenizer errors, clamping past the last line, empty scripts.
- `indent.test.ts`: indent/outdent of a caret line, a multi-line selection, a selection ending at column 1 of the
  next line (that line is not touched), lines with fewer than two spaces, tabs, selection preservation.
- `lineHistory.test.ts`: cap 50, no empty or repeated lines, Up/Down order, draft restore.
- `diff.test.ts`: equal scripts, pure additions, pure removals, a changed line in the middle, line numbers.
- `codeEditor.test.ts` (happy-dom, fake timers): mirror spans and gutter follow input; error appears after 300 ms
  and not before; `aria-invalid` and `aria-describedby`; Ctrl+] / Ctrl+[ act and Tab is not prevented.
- `agentClient.test.ts` (`src/summon/`): stub rejects with `Summon is not configured` and calls no network API.
- `expandDialog.test.ts` (happy-dom): Expand moves the *same* editor element instance into the dialog (identity check)
  and Close/Escape move that same instance back to its original parent and position; typed, uncommitted text and
  the inline error survive both moves; Close commits nothing (no `onCommit`), a later blur or `flush` still commits
  once.
- `scriptSlot.test.ts` / `editor.test.ts`: Explain with the stub shows the status message; Fix with a fake client
  shows the diff; Apply is one history entry and Ctrl+Z restores the old script; Cancel changes nothing; Cancel of a
  pending request aborts it.
- `messageBoxInput.test.ts`: highlighting mirror and history keys.

### REQ-9.2 — Property-based test (fast-check, ≥ 200 runs)

For any script built from tokenizable pieces (keywords in any case, identifiers, numbers, strings, operators,
punctuation, comments, spaces, tabs, CR and newlines) — and, separately, for any arbitrary string — concatenating the
highlight spans reproduces the source text exactly (REQ-1.4).

### REQ-9.3 — End-to-end (Playwright)

`test/e2e/script-editor.spec.ts`: load `/?stack=quiz`; switch to Edit; double-click `BeginButton` to open its
script; replace it with `on mouseUp` / `  go to card "Q1"` / `end mouseDown`; within one second see the inline error
`Line 3: …` and the `!` marker on line 3; correct the last line to `end mouseUp`; see `No errors`; switch to Browse;
click `Enter if you dare...`; assert `data-card-name` is `Q1`. Also: Fix with the stub client shows
`Summon is not configured` in the status line. Existing e2e tests keep passing.

### REQ-9.4 — Playwright MCP

The REQ-9.3 flow is run once through Playwright MCP, one dependent action per call, with a screenshot of the inline
error (`.playwright-mcp/script-editor-error.png`) and one of the expanded editor dialog
(`.playwright-mcp/script-editor-expanded.png`), and recorded in `KIRO_USAGE.md`.

---

## REQ-10 — Constraints

- New code in `src/ui/script-editor/` and `src/summon/agentClient.ts`, plus `src/ui/edit/scriptSlot.ts`, the
  inspector and editor wiring in `src/ui/edit/`, and `src/main.ts`.
- `src/ui/script-editor/` and `src/ui/edit/` may import `src/interp/` (`tokenize`, `KEYWORDS`, `parse`,
  `NecroTalkError`) and the public module `src/summon/agentClient.ts`. `src/summon/` never imports anything from
  `src/ui/` (`structure.md` import table).
- No change to `src/interp/` or `src/model/`. No new dependencies. No `innerHTML`, no `eval`. Files under ~300 lines.
