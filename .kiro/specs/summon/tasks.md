# summon — Tasks

Execute in order. Each task is independently verifiable. Do not start a task until the previous one passes its
acceptance check. Every task ends with `npm run typecheck`, `npm run lint` and `npm test` green. No task modifies
`src/interp/` or `src/model/`, no task adds a dependency, and no unit test makes a real network call.

---

## Task 1 — Steering, contract and limits

**Steps:**
1. `.kiro/steering/tech.md` and `structure.md`: Render (static site + free web service) instead of Cloudflare;
   `server/` at the root instead of `src/worker/` with the same boundaries (imports `src/model/`, `src/summon/`; no
   browser APIs); Gemini REST via `fetch`, no SDKs. `product.md`: "small server" instead of "serverless function".
   `docs/BRIEF.md` sections 6 and 9: one sentence each (Gemini through the AI Studio REST API; Render instead of
   Cloudflare).
2. `src/summon/contract.ts`: `SummonRequest`, `SummonResponse`, error kinds, `LIMITS`, header names,
   `parseSummonRequest`.
3. `contract.test.ts` per the design table.

**Acceptance:** tests green; steering diffs limited to hosting, provider and the `server/` folder.

---

## Task 2 — Prompts

**Steps:**
1. `src/summon/prompts.ts`: instructions, grammar summary, `GRAMMAR_EXAMPLES`, message builders, `buildPrompt`;
   schema imported with `with { type: 'json' }` (fallback per open question 13).
2. `prompts.test.ts` (REQ-1.5): every example parses with `parse`; schema text equals `stack.schema.json`;
   determinism; delimiter escaping; per-kind `json` flag.

**Acceptance:** tests green; `prompts.ts` has no runtime import from `src/interp/`.

---

## Task 3 — Gemini client

**Steps:**
1. `src/summon/gemini.ts`: `generate`, `GeminiError`, `DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'`.
2. `gemini.test.ts` with an injected fake `fetch` and canned Google responses: URL and model, `x-goog-api-key`
   header, key absent from the URL and from every error message, `responseMimeType` per kind, text joined from
   parts, `blockReason` and `finishReason: SAFETY` → `safety`, 429 → `quota`, 401/403/400-invalid-key → `auth`,
   other 400 and 5xx and empty → `upstream`, throw → `network`, timeout (fake timers) → `network`, caller abort →
   `AbortError`, invalid model id rejected.

**Acceptance:** tests green; the module references no `window`, `document`, `localStorage` or `process`.

---

## Task 4 — Extraction, integrity and the pipeline

**Steps:**
1. `extract.ts`, `integrity.ts`, `transport.ts`, `pipeline.ts` (design).
2. `extract.test.ts`, `integrity.test.ts`.
3. `pipeline.test.ts`: both REQ-3.3 PBTs (≥ 100 runs each, fake transport recording requests); examples for a schema
   failure then success, two failures → `SummonError` with all lines, transport error not retried, abort, progress
   order `summoning → validating → retrying → validating`, error-list caps.

**Acceptance:** tests green; both PBTs run ≥ 100 examples; the three fixtures pass `check` unchanged.

---

## Task 5 — Transports, AgentClient and wake-up

**Steps:**
1. `serverTransport.ts`, `directTransport.ts`, `wake.ts`; `createAgentClient` in `agentClient.ts`.
2. Tests per the design table. Extend `agentClient.test.ts`: the "no imports" check becomes "imports only
   `src/summon/`, `src/model/`, `src/interp/`" for every file in `src/summon/`, plus no top-level browser globals.

**Acceptance:** tests green; the stub's existing tests unchanged.

---

## Task 6 — Server

**Steps:**
1. `server/config.ts`, `caps.ts`, `handler.ts`, `main.ts`, `node.d.ts`.
2. `tsconfig.server.json`; root `tsconfig.json` includes `server`; Vitest includes `server/**/*.test.ts`;
   `package.json` scripts `server:build`, `server:start`, `server:dev`, updated `typecheck` and `lint`;
   `engines.node` per open question 14.
3. `caps.test.ts`, `handler.test.ts` (REQ-9.2), calling the handler directly with a fake `generate`.
4. `npm run server:build` produces `dist-server/server/main.js`. Ask the user to run `npm run server:dev` without a
   key and check `GET /api/health` returns `ok: false` and `POST /api/summon` returns 503 `not_configured` (the
   agent's shell cannot start servers). Then, with a real key in `.env`, one real `summon` request confirms that
   `gemini-3.5-flash-lite` is available on the project's free tier.

**Acceptance:** tests green; `server:build` exits 0; `dist-server/` contains no test files.

---

## Task 7 — Dev proxy, env and Render blueprint

**Steps:**
1. `vite.config.ts`: `/api` proxy to `http://localhost:8787`.
2. `.gitignore`: `.env`, `dist-server/`. `.env.example` per the design.
3. `render.yaml` per the design.
4. `README.md`: a short "Running Summon locally" and "Deploying to Render" section (key from AI Studio, set
   `GEMINI_API_KEY` in the dashboard).

**Acceptance:** `npm run build` succeeds; `git check-ignore .env` reports it ignored; `render.yaml` reviewed against
the design and Render's Blueprint spec (there is no YAML parser in the repo to check it mechanically).

---

## Task 8 — Summon and Settings dialogs

**Steps:**
1. `src/ui/summon/summonDialog.ts`, `settingsDialog.ts`, `summon.css`.
2. `stackPicker.ts`: `showCustom(name)`.
3. `src/main.ts`: Summon and Settings toolbar buttons; per-call transport choice; `createAgentClient` replaces the
   stub; wake-up on load; `loadSummoned` (load, Edit mode, picker entry, URL cleanup); busy disabling.
4. Tests (happy-dom, fake transport): progress states including `Waking the server…`, examples fill the textarea,
   failure list rendered with `textContent`, cancel aborts, active path label, remaining count, settings
   save/clear/mask/test, key never in the DOM after Save, `showCustom` behaviour.

**Acceptance:** tests green; `npm run build` succeeds; existing e2e tests pass.

---

## Task 9 — End-to-end and Playwright MCP

**Steps:**
1. `test/e2e/summon.spec.ts` per REQ-9.3 with `page.route` for `**/api/health` and `**/api/summon`; the canned
   stacks live in the spec file (or `test/e2e/summon-fixtures.ts`), built from the quiz fixture's shape.
2. `npm run e2e` — all spec files pass.
3. Ask the user to start `npm run dev`. Through Playwright MCP, one dependent action per call and a
   `browser_evaluate` state check before each screenshot: install the mocked route with `browser_run_code_unsafe`
   (`page.route`), open Summon, click the first example, Summon, wait for Edit mode, check the picker shows the
   stack's name, `browser_take_screenshot` to `.playwright-mcp/summon-loaded.png`, read `browser_console_messages`.
4. `KIRO_USAGE.md` entry.

**Acceptance:** `npm run e2e` green; MCP run shows the summoned stack in Edit mode with no console errors;
screenshot exists.

---

## Task 10 — Final verification

**Steps:**
1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run server:build`, `npm run e2e` — all
   exit 0.
2. `git status -- src/interp src/model fixtures` is clean; `package.json` dependencies and devDependencies
   unchanged.
3. Grep new code for `eval(`, `new Function`, `innerHTML`, `@google/`, `anthropic`; grep `src/summon` for imports of
   `src/ui`; grep for `key=` in any Gemini URL construction.
4. `.env` is ignored and not staged; `.env.example` has no value for `GEMINI_API_KEY`.
5. Files under ~300 lines.

**Acceptance:** all checks pass.
