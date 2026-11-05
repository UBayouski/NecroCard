# summon — Requirements

## Overview

Summon turns a plain-English paragraph into a working stack, and gives the script editor's Explain and Fix actions a
real agent. The AI provider is Google Gemini through the Google AI Studio REST API (`generateContent`); hosting is
Render (one static site, one free web service). No SDK: the browser and the server both call the REST endpoint with
`fetch`.

This is spec 6 of 8. It builds on `stack-model` (`validateStack`, the JSON schema, fixtures),
`necrotalk-interpreter` (`parse`, `NecroTalkError`), `edit-mode` (New Stack, `EditController`) and `script-editor`
(`AgentClient`, `ScriptContext`, `AgentUnavailableError`, the stub client).

Sources: `docs/BRIEF.md` sections 6 (Summon) and 9 (technical choices); steering `product.md` (Summon pipeline, caps,
BYO key, free demo through Jan 29, 2027, sample stacks), `structure.md` (`src/summon/`, `src/worker/` boundaries),
`tech.md` (no SDKs, minimal pinned dependencies, testing tools). This spec overrides two steering defaults on the
user's instruction: Gemini instead of an unspecified provider, and Render instead of Cloudflare (Task 1 updates the
steering files to match).

### In scope

Pure prompt builders; a fetch-only Gemini client; a pure Summon pipeline over an injected transport (extract,
validate, parse, one retry); a server transport and a direct (BYO key) transport; a Node 22 `node:http` server in
`server/` with daily and per-IP caps and CORS; server build scripts, a Vite dev proxy, `.env.example` and
`render.yaml`; the real `AgentClient`; a health wake-up on page load; the Summon and Settings dialogs; Vitest unit
and property tests; Playwright e2e with mocked routes; one Playwright MCP verification run.

### Out of scope

Persistent counters, accounts or auth; streaming responses; the Interactions API; response schemas sent to Gemini
(open question 3); image generation (Summon produces no image objects, open question 12); sharing and the blob store
(spec `sharing`); any change to `src/interp/` or `src/model/`; new runtime or dev dependencies; Anthropic, OpenAI or
Google SDKs.

---

## REQ-1 — Prompts (`src/summon/prompts.ts`, pure)

### REQ-1.1 — System instruction

`SYSTEM_INSTRUCTION` (summon and retry) contains, in this order:
1. The role: produce one NecroCard stack as a single JSON object and nothing else.
2. The full text of `src/model/stack.schema.json`, embedded verbatim.
3. Model rules the schema cannot express: ids are 8–10 characters from `A-Za-z0-9_-` and unique within the stack;
   every card's `backgroundId` names a background in the stack; at least one background and one card; rects lie
   within the 512 × 342 card; metadata dates use the format `2026-11-03T14:00:00.000Z`; no image objects.
4. A NecroTalk grammar summary that matches the frozen subset in `docs/BRIEF.md` section 4 and steering
   `necrotalk.md` — commands, expressions, functions, message order, and the explicit "not supported" list (`do`,
   `sort`, `send`, `find`, `play`, `item`, chunk ranges, chunks as `put` targets, `background`/`stack` references).
5. At least six example scripts covering: a navigation button, a `put` into a field, `answer` with buttons and `it`,
   `if`/`else`, a `repeat`, `global` across handlers, and `openCard`.

`EXPLAIN_INSTRUCTION` and `FIX_INSTRUCTION` contain the same grammar summary and examples (no schema).

### REQ-1.2 — Message builders

- `summonMessage(prompt)` — the user's paragraph, delimited so it cannot close the instruction framing.
- `retryMessage(prompt, previous, errors)` — the original paragraph, the previous reply, and a numbered list of every
  validation and parse error; asks for a complete corrected stack.
- `explainMessage(script, context)` and `fixMessage(script, error, context)` — the script, the `ScriptContext`
  rendered as plain lines (owner, stack, card, background, object names), and for Fix the current error or
  "No parse error is reported". Fix asks for the complete replacement script only, no fences, no prose.

### REQ-1.3 — One entry point for both paths

`buildPrompt(request: SummonRequest)` returns `{ systemInstruction, text, json }`, where `json` is true for summon and
retry. The server and the direct transport both use it, so both paths send identical prompts.

### REQ-1.4 — Request validation

`parseSummonRequest(value: unknown)` returns a typed `SummonRequest` or a list of plain-English problems, enforcing
the field types and the size limits in the design (open question 6). The server uses it on every body; the client
uses the same limits before sending.

### REQ-1.5 — Prompt tests

- Every example script in the grammar summary parses with `parse` from `src/interp`.
- The schema text in `SYSTEM_INSTRUCTION` is `JSON.parse`-equal to `stack.schema.json`.
- Builders are deterministic and never include `undefined` or `[object Object]`.
- A prompt containing the delimiter text does not end the delimited block early.

---

## REQ-2 — Gemini client (`src/summon/gemini.ts`)

### REQ-2.1 — Request

`generate(options)` posts to `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with
headers `Content-Type: application/json` and `x-goog-api-key: <key>`. The key never appears in the URL. Body:
`systemInstruction`, one `user` content with one text part, and `generationConfig.responseMimeType` set to
`application/json` for summon and retry and `text/plain` for explain and fix. Nothing else: no `temperature`, `topP`
or `topK` (deprecated in Google's July 21, 2026 changelog), no `thinkingConfig`, no `responseSchema`, no tools.

### REQ-2.2 — Model id

The model is a parameter; the default is the constant `DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'` (rationale in
the design; open question 1). The model id is checked against `^[a-z0-9.-]+$` before it is put in the URL.

### REQ-2.3 — Result

The first candidate's text (all text parts joined), or a `GeminiError` with `kind`:
`quota` (HTTP 429 or `RESOURCE_EXHAUSTED`), `auth` (401, 403, or 400 with an invalid-key reason), `safety`
(`promptFeedback.blockReason` set, or the first candidate's `finishReason` is `SAFETY`), `network` (`fetch` threw, or
the timeout fired), `upstream` (any other non-2xx, or a 2xx with no text; open question 4). Each error carries a
plain-English message that never contains the key.

### REQ-2.4 — Portability

The module uses only `fetch`, `AbortController`/`AbortSignal`, `JSON` and `URL`. It imports nothing outside
`src/summon/` and runs unchanged in the browser and in Node 22. `fetch` is injectable for tests. A caller-supplied
`AbortSignal` cancels the request; a timeout (default 90 s) produces `network`.

---

## REQ-3 — Pipeline (`src/summon/pipeline.ts`, pure over a transport)

### REQ-3.1 — Steps

`summonStack(prompt, transport, options)`:
1. Send `{ kind: 'summon', payload: { prompt } }`.
2. Extract the JSON object from the reply text (design: whole text, then a fenced block, then the first balanced
   `{…}`).
3. `validateStack` from `src/model/validate.ts`.
4. Integrity checks the schema cannot express: at least one background and one card, ids unique within the stack,
   every `backgroundId` resolves, no image objects. (Rects inside the card are a prompt rule only; off-card objects
   are legal in the model.)
5. `parse` every script — stack, each background, each background object, each card, each card object.
6. If any of 2–5 failed, send exactly one `{ kind: 'retry', payload: { prompt, previous, errors } }` and repeat 2–5 on
   the reply.
7. Return the stack, or throw `SummonError` whose `failures` list everything that failed on the last attempt.

Transport errors are not retried (open question 7). `options.onProgress` reports `summoning`, `validating`,
`retrying`; `options.signal` aborts at any step.

### REQ-3.2 — Error list format

Each failure is one line naming where it happened and what failed, using names users see:
- schema: `Schema: /cards/0/rect/w must be integer`;
- integrity: `Card "Q1": backgroundId "zzzzzzzz" does not match any background`;
- script: `Script of button "Next" on card "Q1": Line 3: Expected "end mouseUp" but found "end click".`

The NecroTalk message is passed through unchanged, so its `Line N:` prefix is always present.

### REQ-3.3 — Property tests (fast-check, ≥ 100 runs each)

- For any fixture-shaped valid stack returned by a fake transport (optionally wrapped in a ```` ```json ```` fence or
  surrounded by prose), the pipeline returns a stack deep-equal to it and sends exactly one request.
- For any valid stack with exactly one broken script (a valid script with one line replaced by a known-bad line),
  the pipeline sends exactly one retry, and that retry's `errors` contain the owner's description and `Line N` for
  the broken line's number. If the fake's retry reply is valid, the pipeline returns it; if not, it throws
  `SummonError` after two requests in total.

---

## REQ-4 — Transports (`src/summon/transport.ts`, `serverTransport.ts`, `directTransport.ts`)

### REQ-4.1 — Interface

`Transport.send(request: SummonRequest, signal?)` resolves to `{ text, remaining? }` or rejects with
`TransportError` (`kind` as REQ-2.3 plus `cap` and `bad_request`, and a message).

### REQ-4.2 — ServerTransport

Posts `{ kind, payload }` as JSON to `${apiBase}/api/summon`, where `apiBase` comes from `VITE_API_URL` (empty in
dev, so the Vite proxy is used). Reads the remaining-count headers into `remaining`. Maps the server's error body to
`TransportError`. Sends no key and no credentials (`credentials: 'omit'`).

### REQ-4.3 — DirectTransport

Builds the prompt with `buildPrompt` and calls `generate` from the browser with the key read from `localStorage`
(`necrocard.geminiKey`) at call time. The key is never read from the URL, the stack, or any other source, and never
written anywhere except by the Settings dialog. `remaining` is undefined.

---

## REQ-5 — Server (`server/`)

### REQ-5.1 — Routes

Node 22 `node:http`, no framework.
- `GET /api/health` → 200 JSON `{ ok: true, model, remainingDay }`; never calls Gemini; not counted.
- `POST /api/summon` → the JSON contract in the design.
- `OPTIONS` on either path → CORS preflight.
- Anything else → 404 JSON; wrong method → 405 with `Allow`.

### REQ-5.2 — Prompts only from kind and payload

The server validates the body with `parseSummonRequest` and builds the prompt with `buildPrompt`. Clients cannot
send a system instruction, a model, generation settings, or free-form prompts beyond the payload fields. Bodies over
64 KiB → 413 without reading further.

### REQ-5.3 — Key and model

`GEMINI_API_KEY` is read from the environment at start; if missing, the server still starts, health reports
`ok: false`, and `/api/summon` returns 503 `not_configured`. `GEMINI_MODEL` overrides the default model. The key is
never logged or returned.

### REQ-5.4 — Caps

In memory: a global counter per UTC day (`DAILY_CAP`, default 100) and a per-IP counter per UTC day (`PER_IP_CAP`,
default 10). Both reset at the first request after UTC midnight. A request counts when it passes validation, before
Gemini is called (open question 8). Over either cap: 429 with a plain-English message and no Gemini call. Every
`/api/summon` response carries `X-Summon-Remaining-Day` and `X-Summon-Remaining-Ip`. The design states that the
counters reset when the process restarts or spins down, and why that is acceptable.

### REQ-5.5 — CORS

`ALLOWED_ORIGINS` is a comma-separated list of exact origins (the Render site and localhost). A request whose
`Origin` is listed gets `Access-Control-Allow-Origin: <origin>`, `Vary: Origin`, and
`Access-Control-Expose-Headers` for the two remaining-count headers. A request with an unlisted `Origin` gets 403 and
no CORS headers. Requests with no `Origin` (Render health checks, curl) are served without CORS headers.

### REQ-5.6 — Testable handler

`createHandler(deps)` takes the config, a `generate` function and a clock, and maps a plain request object to a plain
response object. `server/main.ts` only adapts `node:http` to it. Tests call the handler directly with a fake
`generate`; no sockets in unit tests.

### REQ-5.7 — Logging

One line per request: method, path, status, kind, duration. No prompts, scripts, keys or full IPs.

---

## REQ-6 — Build, scripts and deployment

> **The `render.yaml` shape in this section is superseded by spec `single-service-hosting` (2026-11-04):** one
> `necrocard` web service now serves the built `dist/` and `/api` on one origin, so the static site, `ALLOWED_ORIGINS`
> and `VITE_API_URL` are gone. The build, scripts, `.env`/`.gitignore` and `server/` requirements below are unchanged.

- `tsconfig.server.json` compiles `server/` and the `src/summon/` and `src/model/` modules it imports to
  `dist-server/`; `npm run typecheck` checks it too; `npm run lint` covers `server/`.
- Scripts: `server:build`, `server:start`, `server:dev` (design).
- Vite dev server proxies `/api` to `http://localhost:8787`.
- `.env` is in `.gitignore`; `.env.example` is committed with every variable and no real key; `dist-server/` is in
  `.gitignore`.
- `render.yaml` at the root: a static site (build `npm ci && npm run build`, publish `dist`, `VITE_API_URL` set to the
  literal `https://necrocard-api.onrender.com`, with a comment that the hostname changes if the name is taken) and a free web service (build `npm ci && npm run server:build`, start `npm run server:start`,
  health check `/api/health`, `GEMINI_API_KEY` as a secret with `sync: false`, the cap and origin variables).

---

## REQ-7 — Real AgentClient and wake-up (`src/summon/agentClient.ts`, `src/main.ts`)

### REQ-7.1 — Client

`createAgentClient(transport)` implements `AgentClient`: `explain` sends `explain`, `fix` sends `fix` and strips a
surrounding code fence from the reply. Transport errors become `AgentUnavailableError` with a plain message; aborts
pass through as `AbortError`. The stub stays.

### REQ-7.2 — Selection

`src/main.ts` passes an `AgentClient` that picks the transport per call: Direct when a key is stored, Server
otherwise, so saving or clearing a key in Settings takes effect without a reload. Summon uses the same choice.

### REQ-7.3 — Wake-up

On page load the app sends `GET /api/health` once, in the background. It never blocks rendering, never shows an
error, and is skipped when a key is stored. Its result (`awake`, `remainingDay`) is remembered and used by the
Summon panel's progress line and remaining count.

### REQ-7.4 — Boundaries

`src/summon/` imports only `src/model/`, `src/interp/` and other `src/summon/` files, never `src/ui/`, and never
browser-only globals at module top level (so the server can import `prompts.ts` and `gemini.ts`). The existing
boundary test is extended to every file in `src/summon/`.

---

## REQ-8 — Summon panel and Settings (`src/ui/summon/`)

### REQ-8.1 — Summon dialog

A Summon button in the toolbar opens a chrome dialog (`role="dialog"`, labelled, focus trapped, Escape closes) with:
a prompt textarea (1–2000 characters), three example prompts that fill the textarea when clicked, a Summon button,
a Cancel button, a progress line (`Waking the server…`, `Summoning…`, `Validating…`, `Retrying…`) in an
`aria-live="polite"` region, the active path (`Using the NecroCard server` or `Using your Gemini key`), and the
remaining daily count from the last server response (hidden for the direct path or when unknown).

`Waking the server…` shows while the health request has not succeeded and a server summon is pending.

### REQ-8.2 — Failure

On `SummonError`, the dialog lists every failure line; on a transport error it shows one plain message (for `cap`:
the server's message). The prompt is kept so the user can edit and try again. Cancel aborts the request.

### REQ-8.3 — Success

The stack loads through the same path as New Stack (editor reset, `runtime.load`), then the editor enters Edit mode,
the picker adds and selects an entry showing the stack's name, `?stack=` is removed from the URL, and the dialog
closes. A later fixture or New Stack choice removes the entry, as with Untitled.

### REQ-8.4 — Settings dialog

A Settings button opens a chrome dialog to paste a Gemini key (`type="password"`, `autocomplete="off"`), Test it with
a tiny request (an `explain` of a one-line script through DirectTransport with the pasted key), Save it, or Clear
it. The stored key is shown masked (last 4 characters). The key is stored only in `localStorage` under
`necrocard.geminiKey`. The dialog states that the key stays in this browser and is sent only to Google.

### REQ-8.5 — Chrome only

Both dialogs use chrome styling (`retro-ui.md`), z-index ≤ 1000, accessible names on every control, and do not touch
the card surface. While a summon is pending, the toolbar's picker, New Stack, mode toggle and Summon are disabled.

---

## REQ-9 — Fixtures and testing

### REQ-9.1 — No-AI path

The three fixtures stay the default, work with no network, and are unchanged. The app is fully usable when the
server is down and no key is stored; only Summon, Explain and Fix report the problem.

### REQ-9.2 — Unit and property tests (Vitest)

`prompts.test.ts`, `gemini.test.ts` (request shape, header key, no key in URL, each error kind from canned
responses, abort, timeout), `extract.test.ts`, `integrity.test.ts`, `pipeline.test.ts` (REQ-3.3 PBTs plus examples),
`serverTransport.test.ts`, `directTransport.test.ts`, `agentClient.test.ts` (extended), `server/handler.test.ts`
(routes, validation, 413, caps and headers, UTC day rollover, CORS allowed/denied/no-origin, missing key, Gemini
error mapping, no key in any response), and UI tests for both dialogs (happy-dom).

### REQ-9.3 — End-to-end (Playwright)

`test/e2e/summon.spec.ts`, with `page.route` mocking `/api/health` and `/api/summon` (no real network):
1. Summon "a two-card quiz" → the canned stack loads in Edit mode, the picker shows its name, both cards exist.
2. The first `/api/summon` reply has one broken script; the retry request contains that script's `Line N`; the second
   reply is valid; the stack loads.

### REQ-9.4 — Playwright MCP

One manual run against the dev server with the mocked route: open Summon, summon, confirm Edit mode and the picker
entry, screenshot `.playwright-mcp/summon-loaded.png`, read the console.

---

## REQ-10 — Constraints

- No change to `src/interp/` or `src/model/`; no new dependencies; no SDKs; no `eval`, `new Function` or
  `innerHTML` in new code.
- The key is never placed in a URL, the stack, logs, or server responses.
- Files stay under ~300 lines; one primary export per file where practical.
