# script-editor — Design

## Module map

```
src/ui/script-editor/
├── highlight.ts         # Span, SpanKind, highlightLine(line), highlight(source) — pure, uses tokenize/KEYWORDS
├── errors.ts            # findError(source) → { line, message } | { line: null, message } | null — pure, uses parse
├── indent.ts            # shiftLines(text, selStart, selEnd, 'in' | 'out') → { text, from, to, insert, selStart, selEnd } — pure
├── diff.ts              # diffLines(old, new) → DiffRow[] (LCS) — pure
├── lineHistory.ts       # LineHistory: push, up, down, reset — pure
├── mirror.ts            # renderMirror(pre, lines, errorLine) / renderLineMirror(el, line) — DOM, textContent only
├── codeEditor.ts        # CodeEditor: textarea + mirror + gutter + error region + debounce + indent keys
├── diffView.ts          # DiffView: rows, Apply / Cancel, Escape, focus handling
├── messageBoxInput.ts   # MessageBoxInput: input + one-line mirror + history keys
├── expandDialog.ts      # ExpandDialog: moves the existing editor element into a <dialog> and back
├── script-editor.css    # chrome styles, font-script, token colours
└── *.test.ts
src/summon/
├── agentClient.ts       # AgentClient, ScriptContext, AgentUnavailableError, createStubAgentClient — public module
└── agentClient.test.ts
```

Changed files:

| File | Change |
|---|---|
| `src/ui/edit/scriptSlot.ts` | `createScriptSlot(label, deps)` builds a `CodeEditor` plus Explain/Fix/diff; same `ScriptEditorSlot` interface; `createPlainScriptSlot` and `parseStatus` removed |
| `src/ui/edit/inspector.ts` | takes a `ScriptSlotDeps` factory input and builds each slot's `ScriptContext` from its view and owner |
| `src/ui/edit/editor.ts` | passes `agent` and `status` through to the inspector; `EditControllerDeps.agent` |
| `src/main.ts` | `createStubAgentClient()`; the message box becomes a `MessageBoxInput` |

### Dependency graph

```
edit/scriptSlot → script-editor/{codeEditor, diffView, expandDialog, errors}, summon/agentClient
script-editor/highlight → interp/tokenizer (tokenize, KEYWORDS)
script-editor/errors → interp/parser (parse), interp/errors (NecroTalkError)
script-editor/messageBoxInput → highlight, mirror, lineHistory
summon/agentClient → nothing (no src/ui, no src/interp)
```

The evaluator still imports neither the tokenizer nor the parser; only UI modules do, as `browse-mode` already does.

---

## highlight.ts (pure)

```ts
export type SpanKind = 'keyword' | 'handler' | 'identifier' | 'string' | 'number' | 'operator'
  | 'punctuation' | 'comment' | 'space' | 'invalid';
export interface Span { kind: SpanKind; text: string }

export function highlightLine(line: string): Span[];
export function highlight(source: string): Span[][];   // source.split('\n').map(highlightLine)
```

`highlightLine`:

```
try tokens = tokenize(line) catch → return [{ kind: 'invalid', text: line }] (or [] for '')
pos = 0; prev = null
for t of tokens (skip 'newline', stop at 'eof'):
  start = t.column - 1
  if start > pos: emitGap(line.slice(pos, start))
  len = t.type === 'string' ? t.value.length + 2 : t.value.length
  kind = t.type === 'identifier' && prev is keyword in {on, end, exit, pass} ? 'handler' : KIND[t.type]
  emit { kind, text: line.slice(start, start + len) }
  pos = start + len; prev = t
if pos < line.length: emitGap(line.slice(pos))

emitGap(g): i = first index of a non-whitespace char (space, tab, CR) in g
  i === -1 → [space g] ; else [space g[0..i)] (if non-empty) + [comment g[i..]]
```

Adjacent spans of the same kind are not merged (keeps the code obvious; the mirror does not care). A defensive
check — the gap's comment part must start with `--` — runs in tests only: if the tokenizer ever starts skipping
something else, `highlight.test.ts` fails instead of mis-colouring silently.

Columns are UTF-16 offsets, matching `String.prototype.slice`, so non-ASCII text inside strings and comments lines up.

A small per-line cache (`Map<string, Span[]>`, bounded to 500 entries, cleared when full) avoids re-tokenizing
unchanged lines on every keystroke.

## errors.ts (pure)

```ts
export type ScriptError = { line: number | null; message: string };
export function findError(source: string): ScriptError | null;
```

`source.trim() === ''` → `null`. Otherwise `parse(source)`; on `NecroTalkError` →
`{ line: clamp(e.line, 1, lineCount), message: e.message }`; on any other error → `{ line: null, message }`.

## indent.ts (pure)

```ts
export interface Shift { text: string; from: number; to: number; insert: string; selStart: number; selEnd: number }
export const INDENT = '  ';
export function shiftLines(text: string, selStart: number, selEnd: number, dir: 'in' | 'out'): Shift | null;
```

The affected range runs from the start of the line containing `selStart` to the end of the line containing
`selEnd`, except that a selection ending exactly at column 1 of a line does not touch that line. `text` is the full
result (for tests and the fallback); `selStart`/`selEnd` are the shifted selection. `from`/`to`/`insert` describe the
replacement handed to the browser for native undo, and depend on how many lines are touched:

- **One line** (caret or a selection within the line): only the indentation is touched. Indent is
  `from === to === lineStart`, `insert = '  '`; outdent selects the leading spaces (`[lineStart, lineStart + n)`) with
  `insert = ''` and is applied with `execCommand('delete')`. The browser's undo of such an edit restores a caret, not
  a selection over the whole line (found in a manual Chrome check).
- **Several lines:** the whole line range is replaced with one `insertText`.

`null` when nothing changes (outdent with no indentation).

## diff.ts (pure)

```ts
export interface DiffRow { kind: 'same' | 'add' | 'del'; text: string; oldLine: number | null; newLine: number | null }
export function diffLines(oldText: string, newText: string): DiffRow[];
```

Classic LCS table over lines (`O(n·m)`), backtracked into rows; deletions are listed before additions at each
change. If `n · m > 250 000` (scripts beyond ~500 lines each), it falls back to "all old lines removed, all new lines
added" — still correct, just less precise.

## lineHistory.ts (pure)

```ts
export class LineHistory {
  constructor(cap = 50);
  push(line: string): void;          // ignores '' and a repeat of the last entry; drops the oldest past cap
  up(current: string): string | null;   // first Up stores `current` as the draft
  down(): string | null;                // past the newest → the draft, then null
  reset(): void;                        // after submit: leave browsing mode
  readonly entries: readonly string[];
}
```

---

## CodeEditor (codeEditor.ts)

```
div.code-editor
├── div.code-editor-body               (position: relative; resizable vertically)
│   ├── div.code-editor-gutter[aria-hidden]   one div per line number; error line gets "!" + class
│   └── div.code-editor-text            (position: relative)
│       ├── pre.code-editor-mirror[aria-hidden]   lines → spans (mirror.ts)
│       └── textarea.code-editor-input  (color: transparent; caret-color: #000; background: transparent)
└── div.code-editor-status[role=status][aria-live=polite]   "No errors" / error message
```

```ts
export interface CodeEditorOptions { id: string; label: string; rows?: number; debounceMs?: number }
export class CodeEditor {
  readonly el: HTMLElement;
  readonly textarea: HTMLTextAreaElement;
  get value(): string;
  set(source: string): void;            // value + highlight + immediate error check
  setReadOnly(on: boolean): void;
  setStatus(text: string): void;        // e.g. "Asking Summon…"; the next error check replaces it
  get error(): ScriptError | null;
  onInput(cb: () => void): void;
  destroy(): void;                      // clears the debounce timer
}
```

- `input` → `renderMirror` + gutter now; error check after `debounceMs` (default 300) via `setTimeout`, restarted on
  each input.
- `scroll` on the textarea → copy `scrollTop`/`scrollLeft` to the mirror and `scrollTop` to the gutter.
- Shared metrics (font-script 12px, line-height 16px, padding 4px, `tab-size: 2`, `white-space: pre`, no wrapping)
  live in one CSS rule applied to both the textarea and the mirror.
- `keydown`: `(ctrlKey || metaKey) && key === ']' | '['` → `shiftLines`; apply by selecting `[from, to)` and
  `document.execCommand('insertText', false, insert)` when it returns `true`, else `setRangeText(insert, from, to)` +
  dispatch `input`; then set the shifted selection; `preventDefault`. No other key is intercepted.

## DiffView (diffView.ts)

```ts
export class DiffView {
  constructor(oldText: string, newText: string, handlers: { apply(): void; cancel(): void });
  readonly el: HTMLElement;            // section[aria-label="Proposed fix"]
}
```

A heading (`Proposed fix`, `tabindex="-1"`, focused on open), a `<table>` with columns Old, New, Change, Line
(markers as text: `−`, `+`, ` `), and Apply/Cancel buttons. Escape on the section → cancel. Rows are built with
`textContent`.

## Slot (src/ui/edit/scriptSlot.ts)

```ts
export interface ScriptSlotDeps {
  agent: AgentClient;
  context(): ScriptContext;
  status: { show(message: string): void; clear(): void };
}
export function createScriptSlot(label: string, deps: ScriptSlotDeps): ScriptEditorSlot;
```

State machine: `editing` → (Explain) `pending` → `editing` + explanation panel | status message; `editing` →
(Fix) `pending` → `diff` | status message; `diff` → Apply → `editing` (text set + committed) | Cancel → `editing`.
In `pending`, an `AbortController` is held and Cancel calls `abort()`; a result arriving after abort is ignored.
`commit()` while in `diff` or `pending` commits the editor's current text (unchanged by the agent), so the
inspector's flush-before-operation rule still holds. Apply is `editor.set(proposal)` then `commit()`, which calls
the inspector's `setScript` once → one history entry.

Context comes from the inspector: for an object slot, `{ owner: { type, name }, stackName, cardName,
backgroundName, objectNames }`; for card/background/stack slots the owner is the card, background or stack.

## MessageBoxInput (messageBoxInput.ts)

```
div.message-box-wrap  (position: relative)
├── div.message-box-mirror[aria-hidden]   one line of spans, translateX(-scrollLeft) on input/scroll/keyup
└── input.message-box (color: transparent; caret-color)
```

`main.ts` keeps its Enter handler; it calls `history.push(value)` before running the line and `history.reset()`
afterwards. Up/Down call `history.up(value)` / `history.down()` and set `value`, caret to end, re-render mirror.

## Agent (src/summon/agentClient.ts)

One public module of `src/summon/`: the `AgentClient` interface, `ScriptContext`, `AgentUnavailableError`, and
`createStubAgentClient()`, which returns `Promise.reject(new AgentUnavailableError('Summon is not configured'))`
from both methods (after checking `signal?.aborted`). It imports nothing. `src/ui/` imports it (allowed by the
amended `structure.md` table); `src/summon/` never imports `src/ui/`. Spec `summon` adds the real client to this
folder next to the stub.

## ExpandDialog (expandDialog.ts)

```ts
export class ExpandDialog {
  constructor(editorEl: HTMLElement, options: { title: string; onOpen?(): void; onClose?(): void });
  open(): void;          // moves editorEl into the dialog, showModal(), adds .code-editor--expanded (24 rows)
  close(): void;         // moves editorEl back to the remembered parent/next sibling, dialog.close()
  readonly isOpen: boolean;
}
```

`open()` records `editorEl.parentNode` and `editorEl.nextSibling`, inserts a hidden placeholder comment there (so
the original position survives sibling changes), then appends `editorEl` itself to the dialog body. `close()` puts
the same element back where the placeholder is and removes the placeholder. Because the element is moved, not
copied, every listener, timer, `AbortController`, and the textarea's value, selection and undo stack are untouched.
Neither method commits; the `cancel` event (Escape) is routed to `close()`. The slot calls `close()` from its
`destroy` path, which the inspector calls before rebuilding.

---

## Styling (script-editor.css)

Chrome only. Token colours on the white editor background, colour only (no weight or style changes, so the
transparent textarea glyphs and the mirror glyphs keep identical advances):

| Kind | Colour | Contrast on #fff |
|---|---|---|
| keyword | `#1f3f8f` | ≥ 9:1 |
| handler | `#0b5d2a` | ≥ 7:1 |
| string | `#7a3b00` | ≥ 8:1 |
| number | `#5b2a86` | ≥ 9:1 |
| comment | `#5f5f5f` | ≥ 6:1 |
| operator, punctuation, identifier, space | `#1a1a1a` | ≥ 17:1 |
| invalid | `#8a1010` with dotted underline | ≥ 8:1 |
| error line | wavy `#8a1010` underline, gutter `!` | — |

`::selection` on the textarea and on the message box input uses a translucent background,
`rgba(201, 211, 238, 0.55)`, so the highlighted mirror text shows through the selection (an opaque colour hid it,
found in a manual Chrome check; a CSS test asserts alpha < 1). The caret is `#000`.

---

## Testing strategy

| File | Env | Covers |
|---|---|---|
| `highlight.test.ts` | node | REQ-1 kinds, handler rule, CRLF, invalid lines, gap rule check, PBT (REQ-9.2) |
| `errors.test.ts` | node | REQ-3 mapping and clamping |
| `indent.test.ts` | node | REQ-4 |
| `diff.test.ts` | node | REQ-5.4 diff rows and line numbers, large-input fallback |
| `lineHistory.test.ts` | node | REQ-7 |
| `codeEditor.test.ts` | happy-dom | mirror/gutter sync, 300 ms debounce with fake timers, ARIA, indent keys, Tab untouched |
| `diffView.test.ts` | happy-dom | rows and markers, Apply/Cancel/Escape, focus |
| `messageBoxInput.test.ts` | happy-dom | mirror, Up/Down, draft |
| `src/summon/agentClient.test.ts` | node | stub rejection, abort, no network APIs referenced, no imports |
| `expandDialog.test.ts` | happy-dom | same element instance moves in and back; text and error survive; Close commits nothing |
| `src/ui/edit/scriptSlot.test.ts` | happy-dom | Explain/Fix flows with stub and fake clients, Cancel aborts |
| `src/ui/edit/editor.test.ts` (extended) | happy-dom | Fix → Apply is one history entry; Ctrl+Z restores |
| `test/e2e/script-editor.spec.ts` | Playwright | REQ-9.3 |

---

## Open questions (all accepted; 11 and 12 as amended)

1. **Comments without a comment token.** The tokenizer strips comments. Default: classify the non-whitespace part of
   a gap as a comment (the tokenizer skips nothing else), guarded by a test. Alternative: a reviewed interpreter
   change that emits `comment` tokens (or start/end offsets on every token).
2. **Per-line tokenization.** Default: each line is tokenized on its own, so one bad line shows as `invalid` while
   the rest stay highlighted. This relies on no token spanning lines, which holds today.
3. **Palette.** Default: the restrained colour palette above, colour only, no bold/italic (metric safety with the
   generic monospace fallback). Alternative: greyscale only, closer to "quiet chrome" but harder to read.
4. **Native undo for indent.** Default: `document.execCommand('insertText')` (deprecated but still the only way to
   keep the textarea's own undo stack in Chromium and Firefox), with `setRangeText` as fallback (no native undo
   there; the inspector's history still covers committed text).
5. **Error scope.** Default: parse errors only, first error only, debounced 300 ms; runtime errors stay in browse
   mode's status line.
6. **Commit timing.** Default: unchanged from edit-mode — commit on blur or flush; inline errors never block a commit.
7. **Fix input.** Default: Fix is always available and sends the current inline error or `null`; Explain's answer
   appears in a read-only panel under the editor.
8. **Cancellation.** Default: `AbortSignal` in both methods; the editor is read-only while a request is pending and
   while the diff is open, so the proposal always applies to the text it was made from.
9. **Diff layout.** Default: one unified table with old/new line numbers and `−`/`+` markers; LCS with a fallback
   above 250 000 cells. Alternative: side-by-side columns (needs more width than the 240 px inspector has).
10. **Message box history.** Default: 50 lines, in memory, global across stack loads, consecutive duplicates
    collapsed, draft restored; not persisted.
11. **Where `AgentClient` lives.** Decided: `src/summon/agentClient.ts` (interface, `ScriptContext`,
    `AgentUnavailableError` and the stub). `structure.md` now lets `src/ui/` import `src/summon/` public modules,
    and `src/summon/` never imports `src/ui/`.
12. **Inspector width.** Accepted: 10 visible rows in the inspector, vertically resizable, horizontal scrolling, plus
    the Expand dialog (REQ-5.5) for a 640 px, 24-row view of the same editor.
