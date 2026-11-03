# script-editor — Tasks

Execute in order. Each task is independently verifiable. Do not start a task until the previous one passes its
acceptance check. Every task ends with `npm run typecheck`, `npm run lint` and `npm test` green. No task modifies
`src/interp/` or `src/model/`, and no task adds a dependency.

---

## Task 1 — Highlighting and the round-trip PBT

**Steps:**
1. `src/ui/script-editor/highlight.ts`: `Span`, `SpanKind`, `highlightLine`, `highlight`, bounded line cache.
2. `highlight.test.ts`: one example per kind; handler after `on`/`end`/`exit`/`pass`; keyword case kept; strings with
   quotes; comment after code and alone; CRLF; tabs; an `invalid` line among valid ones; every `comment` span starts
   with `--` on a corpus that includes all three fixtures' scripts.
3. PBT (REQ-9.2, ≥ 200 runs each): scripts assembled from tokenizable pieces reproduce exactly; arbitrary strings
   (full Unicode) reproduce exactly.

**Acceptance:** tests green; both PBTs run ≥ 200 examples.

---

## Task 2 — Errors, indent, diff, history (pure)

**Steps:**
1. `errors.ts`, `indent.ts`, `diff.ts`, `lineHistory.ts` (design).
2. Tests per REQ-9.1 for each module, including diff line numbers and the large-input fallback, and indent
   selection preservation.

**Acceptance:** tests green.

---

## Task 3 — Agent interface and stub

**Steps:**
1. `src/summon/agentClient.ts`: `AgentClient`, `ScriptContext`, `AgentUnavailableError`, `createStubAgentClient`.
2. `.kiro/steering/structure.md`: `src/ui/` may import `src/summon/` public modules; `src/summon/` never imports
   `src/ui/` (done with the spec amendment; verify).
3. `agentClient.test.ts`: both methods reject with `Summon is not configured` as `AgentUnavailableError`; an aborted
   signal rejects too; no network APIs referenced (source check); the module has no imports at all.

**Acceptance:** tests green.

---

## Task 4 — CodeEditor

**Steps:**
1. `mirror.ts`, `codeEditor.ts`, `script-editor.css` (design).
2. `codeEditor.test.ts` (happy-dom, `vi.useFakeTimers()`): typing updates mirror spans and gutter synchronously;
   the error appears at 300 ms and not at 299 ms; `aria-invalid`, `aria-describedby`, `!` gutter marker, wavy line
   class; `set` checks immediately; scroll sync; Ctrl+] / Ctrl+[ / ⌘] shift lines and keep the selection; Tab and
   Shift+Tab are not `defaultPrevented`; mirror content contains no elements other than `span`s (no HTML injection
   from `<b>` in a string).

**Acceptance:** tests green; `script-editor.css` uses only chrome colours with ≥ 4.5:1 contrast (checked by a small
contrast test over the token colour list).

---

## Task 5 — Diff view, Expand dialog and the slot

**Steps:**
1. `diffView.ts` and `expandDialog.ts`.
2. `src/ui/edit/scriptSlot.ts`: `createScriptSlot(label, deps)` with Explain, Fix, diff and Expand; remove
   `createPlainScriptSlot` and `parseStatus`.
3. `inspector.ts` and `editor.ts`: pass `ScriptSlotDeps` (agent, per-slot context, status); `EditControllerDeps.agent`;
   the inspector closes any open Expand dialog before rebuilding.
4. Tests: `diffView.test.ts`; `expandDialog.test.ts` (the same element instance moves into the dialog and back on
   Close and on Escape; uncommitted text, selection and the inline error survive; Close commits nothing; a later
   blur or flush commits once); `scriptSlot.test.ts` (Explain with the stub → status message; Explain with a fake
   client → explanation panel; Fix → diff; Apply → one `onCommit`; Cancel → none; Cancel while pending aborts and
   ignores a late result; `commit()` during `diff` commits the unchanged editor text); extend `editor.test.ts`: Fix →
   Apply is one history entry and Ctrl+Z (outside text controls) restores the previous script; the inspector tests
   still pass with the new slot.

**Acceptance:** tests green; existing edit-mode tests unchanged except where they referred to `parseStatus` or the
plain textarea's status text.

---

## Task 6 — Message box

**Steps:**
1. `messageBoxInput.ts` and its styles.
2. `src/main.ts`: use `MessageBoxInput`; push to history on Enter; inject `createStubAgentClient()` into the editor.
3. `messageBoxInput.test.ts`: mirror spans; Up/Down; draft restore; cap; caret at end.

**Acceptance:** tests green; `npm run build` succeeds; existing browse and edit e2e tests pass.

---

## Task 7 — End-to-end and Playwright MCP

**Steps:**
1. `test/e2e/script-editor.spec.ts` per REQ-9.3, including the stub `Summon is not configured` check.
2. `npm run e2e` — all spec files pass.
3. Ask the user to start `npm run dev`. Through Playwright MCP, one dependent action per call and a
   `browser_evaluate` state check before each screenshot: open `BeginButton`'s script, type the broken handler,
   wait for the inline error, `browser_take_screenshot` to `.playwright-mcp/script-editor-error.png`, click Expand
   and screenshot the dialog to `.playwright-mcp/script-editor-expanded.png`, close it, fix the line,
   switch to Browse, click, confirm `Q1`, read `browser_console_messages`.
4. `KIRO_USAGE.md` entry.

**Acceptance:** `npm run e2e` green; MCP run reaches `Q1` with no console errors; screenshot exists.

---

## Task 8 — Final verification

**Steps:**
1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e` — all exit 0.
2. `git status -- src/interp src/model` is clean; `package.json` dependencies unchanged.
3. No module outside `src/interp/` lexes NecroTalk: grep `src/ui/script-editor` for regexes over keywords or
   character classes used to split tokens; the only lexical input is `tokenize`.
4. Files under ~300 lines; no `innerHTML`, `eval`, `fetch(` in the new folders.

**Acceptance:** all checks pass.
