# sharing — Tasks

Execute in order. Each task is independently verifiable. Do not start a task until the previous one passes its
acceptance check. Every task ends with `npm run typecheck`, `npm run lint` and `npm test` green. No task modifies
`src/interp/`, `src/model/`, `src/summon/` or `server/`, and no task adds a dependency.

---

## Task 1 — Steering, BRIEF and the codec

**Steps:**
1. `docs/BRIEF.md` section 7 and `.kiro/steering/product.md`: one sentence each — sharing is by compressed URL
   fragment only, with no serverless blob store; large stacks rely on the length warning and Export.
2. `src/share/codec.ts`: `encodeStack`, `decodeStack`, `ShareDecodeError`, base64url helpers (design).
3. `codec.test.ts` (node): REQ-1.4 round-trip PBT (≥ 100 runs) with a local fixture-shaped generator; base64url-only
   output; a stack carrying a 512×342 1-bit image data URL round-trips (exercises the chunked `btoa`); tampered,
   truncated, empty and garbage inputs reject as `ShareDecodeError`; a valid non-stack JSON object rejects with the
   schema message; no raw `SyntaxError`/`DOMException` escapes and no unhandled rejection from `pipe`.

**Acceptance:** tests green; the PBT runs ≥ 100 examples; `codec.ts` imports only `src/model/`.

---

## Task 2 — Autosave

**Steps:**
1. `src/share/autosave.ts`: `createAutosave`, `chooseInitialLoad`, `AUTOSAVE_KEY`, `FRAGMENT_PARAM` (design).
2. `autosave.test.ts` (happy-dom, fake timers, fake storage): debounce coalescing to one write after 500 ms;
   `saveNow` flushes the pending timer; the four-way priority order; corrupt and unavailable storage fall through
   with `corruptAutosave` set only when a value was present but unreadable; a load with autosave off writes nothing,
   so a prior autosave value is unchanged.

**Acceptance:** tests green.

---

## Task 3 — Export and import

**Steps:**
1. `src/share/file.ts`: `exportStack`, `readStackFile`, `pickStackFile`, `safeFileName`, `ShareImportError`.
2. `file.test.ts` (happy-dom, fake anchor + URL factory): export sets the right `download` name and a blob URL whose
   content decodes to the stack; `readStackFile` validates and maps each failure; `safeFileName` cases;
   `pickStackFile` resolves with a file and with null.

**Acceptance:** tests green; no real download or navigation in tests.

---

## Task 4 — Share dialog

**Steps:**
1. `src/ui/share/shareDialog.ts` and `share.css` (reusing the summon dialog shell and styles).
2. `shareDialog.test.ts` (happy-dom): the URL input holds `origin+pathname+#s=…` with no query; the length line;
   the warning only past 8000; Copy uses `clipboard.writeText` and falls back to select + `execCommand` then the
   manual prompt; Export and Import call their injected deps; an import error shows in the dialog and keeps it open.

**Acceptance:** tests green.

---

## Task 5 — Integration

**Steps:**
1. `EditController`: optional `onChange()` called after each successful `op` commit; add to `EditControllerDeps`.
2. `BrowseRuntime`: `get currentStack(): Stack | null`.
3. `src/main.ts`: build a guarded `StorageLike`; `createAutosave`; wire `onChange` and the message-box / unlocked-
   field-typing paths to the autosave (not button-script dispatches); `chooseInitialLoad` on start with the four
   sources; `openShared(encoded)` (decode → Browse with `autosave: false` → `showCustom` → clear `#`); the Share
   button and `ShareDialog`; `onImported` loads in Edit like a summoned stack; the corrupt autosave and bad-fragment
   status messages.
4. `boundary.test.ts`: every `src/share/` file imports only `src/model/`.
5. Extend `editor.test.ts`: `onChange` fires once per committed op and not on a no-op; existing tests still pass.

**Acceptance:** tests green; `npm run build` succeeds; existing browse, edit, script-editor and summon e2e tests
pass.

---

## Task 6 — End-to-end and Playwright MCP

**Steps:**
1. `test/e2e/sharing.spec.ts` per REQ-6.2: autosave survives reload; the Share URL opens the same stack in a second
   page; Export's download decodes to the open stack; Import loads it. Use the same `apiMock` fixture as the other
   specs. Read the download with Playwright's `download` event; decode it with the project codec in `page.evaluate`
   or by importing `decodeStack` in the spec.
2. `npm run e2e` — all spec files pass.
3. Ask the user to start `npm run dev`. Through Playwright MCP, one dependent action per call with a
   `browser_evaluate` state check before each screenshot: open the quiz, open the Share dialog, read the URL from
   the input, open it in a second tab, confirm the same first card, `browser_take_screenshot` to
   `.playwright-mcp/share-opened.png`, read `browser_console_messages`.
4. `KIRO_USAGE.md` entry.

**Acceptance:** `npm run e2e` green; the MCP run shows the shared stack's first card with no console errors;
screenshot exists.

---

## Task 7 — Final verification

**Steps:**
1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run server:build`, `npm run e2e` — all
   exit 0.
2. `git status -- src/interp src/model src/summon server` is clean; `package.json` dependencies unchanged.
3. Grep new code for `eval(`, `new Function`, `innerHTML`, a server URL, `fetch(`; grep `src/share` for imports of
   `src/summon`, `src/interp`, `src/ui` or `server`.
4. Files under ~300 lines.

**Acceptance:** all checks pass.
