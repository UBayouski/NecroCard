# summon — Design

## Module map

```
src/summon/
├── agentClient.ts        # existing: AgentClient, ScriptContext, stub; + createAgentClient(transportFor)
├── contract.ts           # SummonRequest, SummonResponse, ErrorKind, LIMITS, parseSummonRequest, header names
├── prompts.ts            # SYSTEM/EXPLAIN/FIX instructions, example stack, message builders, buildPrompt
├── grammar.ts            # GRAMMAR_SUMMARY, GRAMMAR_EXAMPLES, RESERVED_WORDS (split out of prompts.ts for size)
├── gemini.ts             # generate(): fetch-only generateContent client, GeminiError, DEFAULT_GEMINI_MODEL
├── extract.ts            # extractJsonObject(text)
├── integrity.ts          # checkIntegrity(stack) and scriptsOf(stack) (owner descriptions)
├── pipeline.ts           # summonStack(prompt, transport, options), SummonError
├── transport.ts          # Transport, TransportReply, TransportError
├── serverTransport.ts    # createServerTransport(apiBase, fetch?)
├── directTransport.ts    # createDirectTransport(readKey, model?, fetch?), KEY_STORAGE
└── wake.ts               # createWakeState(apiBase, fetch?): health once, remembered
server/
├── config.ts             # readConfig(env) → ServerConfig (defaults, parsing ALLOWED_ORIGINS)
├── caps.ts               # createCaps(dailyCap, perIpCap): check/consume per UTC day
├── handler.ts            # createHandler({ config, generate, now }) → (PlainRequest) => Promise<PlainResponse>
├── adapter.ts            # clientIp, maskIp, plainHeaders, readBody (body limit) for node:http
├── main.ts               # entry point: node:http server, logging, listen(PORT)
└── node.d.ts             # minimal ambient types for node:http and process (no @types/node)
src/ui/summon/
├── summonDialog.ts       # Summon panel
├── settingsDialog.ts     # BYO key dialog
└── summon.css            # chrome styles for both
```

`src/ui/browse/stackPicker.ts` gains `showCustom(name)`; `src/main.ts` wires the toolbar buttons, the per-call
transport choice, the wake-up and `loadSummoned(stack)`.

Import graph (runtime): `server/*` → `src/summon/{contract,prompts,gemini}.ts` → `src/model/stack.schema.json`.
The browser bundle adds `pipeline.ts` → `src/model/validate.ts` (ajv) and `src/interp/parser.ts`. The server never
imports `validate.ts` or the interpreter; it only builds prompts and forwards text.

---

## Browser ↔ server JSON contract

`POST {apiBase}/api/summon`, `Content-Type: application/json`, body ≤ 64 KiB (`LIMITS.bodyBytes = 65536`).

```ts
type SummonRequest =
  | { kind: 'summon';  payload: { prompt: string } }
  | { kind: 'retry';   payload: { prompt: string; previous: string; errors: string[] } }
  | { kind: 'explain'; payload: { script: string; context: ScriptContext } }
  | { kind: 'fix';     payload: { script: string; error: string | null; context: ScriptContext } };

const LIMITS = {
  prompt: 2000,        // characters, after trim; ≥ 1
  previous: 48000,     // the previous model reply (truncated by the client before sending)
  errors: 40,          // items; each ≤ 400 characters (the client truncates both)
  script: 20000,
  error: 400,
  contextName: 200,    // every string in ScriptContext
  contextObjects: 200, // objectNames entries
  bodyBytes: 65536,
} as const;
```

`ScriptContext` is the existing type from `agentClient.ts`; `parseSummonRequest` checks every field, rejects unknown
keys at every level, and rejects `owner.type` / `objectNames[].type` outside their enums.

Success, HTTP 200:

```json
{ "ok": true, "text": "<first candidate text>" }
```

Failure, any non-2xx:

```json
{ "ok": false, "error": { "kind": "cap", "message": "The daily Summon limit is used up. Try again after 00:00 UTC, or add your own Gemini key in Settings." } }
```

| `error.kind` | HTTP | When |
|---|---|---|
| `bad_request` | 400 | Not JSON, or `parseSummonRequest` failed (message lists the problems) |
| `forbidden` | 403 | `Origin` present and not in `ALLOWED_ORIGINS` |
| `not_found` / `method` | 404 / 405 | Unknown path / wrong method (`Allow` header set) |
| `too_large` | 413 | Body over 64 KiB |
| `cap` | 429 | Daily or per-IP cap reached (`Retry-After` = seconds to next UTC midnight) |
| `not_configured` | 503 | `GEMINI_API_KEY` missing |
| `quota` | 503 | Gemini returned 429 / `RESOURCE_EXHAUSTED` |
| `auth` | 502 | Gemini rejected the server's key (message does not say more) |
| `safety` | 422 | Gemini blocked the prompt or the reply |
| `network` | 504 | Gemini unreachable or timed out (60 s on the server) |
| `upstream` | 502 | Any other Gemini failure, or no text |

Headers on every `/api/summon` response, including 4xx/5xx once the caps were consulted:

```
X-Summon-Remaining-Day: <integer ≥ 0>
X-Summon-Remaining-Ip:  <integer ≥ 0>
Access-Control-Expose-Headers: X-Summon-Remaining-Day, X-Summon-Remaining-Ip   (CORS responses only)
Cache-Control: no-store
```

`GET /api/health` → 200 `{ "ok": true, "model": "gemini-3.5-flash-lite", "remainingDay": 87 }`, or
`{ "ok": false, ... }` when no key is configured (still 200, so Render's health check passes and the static site can
fall back). Not counted, no Gemini call.

`ServerTransport` maps: 200 → `{ text, remaining: { day, ip } }`; JSON error body → `TransportError(kind, message)`;
non-JSON error body or `fetch` throw → `network` with `The NecroCard server is not reachable.`

---

## Prompts

```ts
export interface BuiltPrompt { systemInstruction: string; text: string; json: boolean }
export function buildPrompt(request: SummonRequest): BuiltPrompt;
export const GRAMMAR_EXAMPLES: readonly { title: string; script: string }[];
```

- The schema is embedded with `import schema from '../model/stack.schema.json' with { type: 'json' }` and
  `JSON.stringify(schema, null, 2)`. The import attribute is required for Node's ESM loader; TypeScript 6 and Vite 8
  accept it. If either rejects it in Task 2, fall back to a generated `src/summon/schemaText.ts` written by
  `scripts/check-schema.mjs` (open question 13).
- The grammar summary is a hand-written string mirroring `necrotalk.md` (statements, expressions, functions, error
  style, the not-supported list). `GRAMMAR_EXAMPLES` are interpolated into it; the test parses each one.
- User text is wrapped as `<<<PARAGRAPH\n…\nPARAGRAPH>>>`. Any occurrence of `PARAGRAPH>>>` inside the user text is
  replaced with `PARAGRAPH> > >` before wrapping (same for `SCRIPT`, `PREVIOUS`). This is framing, not security: the
  server's caps and fixed instructions are what limit abuse.
- Retry text: the paragraph, `Your previous reply:` + the previous text, `It failed these checks:` + numbered errors,
  `Return the complete corrected stack as one JSON object.`

## Gemini client

```ts
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
export type GeminiErrorKind = 'quota' | 'auth' | 'safety' | 'network' | 'upstream';
export class GeminiError extends Error { constructor(readonly kind: GeminiErrorKind, message: string, readonly status?: number) }
export interface GenerateOptions {
  apiKey: string; prompt: BuiltPrompt; model?: string;
  signal?: AbortSignal; timeoutMs?: number; fetch?: typeof fetch;
}
export function generate(options: GenerateOptions): Promise<string>;
```

Request body:

```json
{
  "systemInstruction": { "parts": [{ "text": "<systemInstruction>" }] },
  "contents": [{ "role": "user", "parts": [{ "text": "<text>" }] }],
  "generationConfig": { "responseMimeType": "application/json" }
}
```

Nothing else is sent: no `temperature`, `topP` or `topK` (Google's changelog for July 21, 2026 deprecates them), no
`thinkingConfig`, no `responseSchema`, no tools.

`responseMimeType` is `text/plain` for explain and fix. Response handling: `promptFeedback.blockReason` → `safety`;
`candidates[0].finishReason === 'SAFETY'` → `safety`; otherwise join `candidates[0].content.parts[].text`; empty →
`upstream`. Errors read `error.status` / `error.message` from Google's JSON error body when present. Status 400 is
`auth` only when the body mentions `API_KEY_INVALID` or "API key not valid"; other 400s are `upstream`. Messages
are fixed English strings plus the HTTP status; Google's message text is not echoed to the browser (it can quote
the request).

Timeout: an internal `AbortController` combined with the caller's signal (`AbortSignal.any`, available in Node 22 and
current browsers); timeout → `network` "Gemini did not answer in time"; caller abort → rethrow `AbortError`.

### Model id: `gemini-3.5-flash-lite`

Verified against Google's official Gemini API docs (models, pricing, deprecations pages, read November 3, 2026):
- `gemini-3.5-flash-lite` is a stable model id (free-tier availability: see the note below).
- `gemini-2.5-flash`, the usual free default, is deprecated; from December 1, 2026 Google routes its requests to
  `gemini-3.5-flash-lite`, i.e. Google names it the successor for exactly this use.
- Flash-Lite is the cheapest and fastest tier, which matters for the 1-minute cold start budget and for free-quota
  headroom; stack JSON is structured, schema-guided output where Lite has been adequate in the docs' positioning.
- The alternative is `gemini-3.8-flash` (Google's "most intelligent Flash model", also free, successor of deprecated
  `gemini-2.5-pro`) for better scripts at lower free quota (open question 1).

Free-tier requests per day are per project and shown only in AI Studio; the docs do not publish a number, so the
server caps are not derived from Google's quota.

The model's free-tier availability for this project was not confirmed from the docs pages alone; it was confirmed by
the first real request in Task 6 (November 3, 2026: an `explain` through `npm run server:dev` returned 200 with text
in 819 ms on the free tier).

## Extraction

`extractJsonObject(text): { value: unknown } | { error: string }`:
1. `JSON.parse(text.trim())` if it starts with `{`.
2. Else the first ```` ```json ```` or ```` ``` ```` fenced block.
3. Else the first balanced `{ … }` found by a string-aware brace scanner (skips braces inside JSON strings).
4. Else `Reply was not a JSON object`. A top-level array or primitive → `Reply was not a JSON object`.

## Integrity and scripts

```ts
export interface ScriptSite { where: string; script: string }   // where: 'Script of button "Next" on card "Q1"'
export function scriptsOf(stack: Stack): ScriptSite[];
export function checkIntegrity(stack: Stack): string[];          // [] when fine
```

Owner descriptions: `stack "X"`, `background "B"`, `button "N" on background "B"`, `card "C"`, `field "N" on card
"C"`. Empty scripts are skipped (they parse).

## Pipeline

```ts
export type SummonProgress = 'summoning' | 'validating' | 'retrying';
export class SummonError extends Error { constructor(readonly failures: string[]) }
export async function summonStack(prompt: string, transport: Transport,
  options?: { signal?: AbortSignal; onProgress?(p: SummonProgress): void }): Promise<Stack>;

function check(text: string): { stack: Stack } | { errors: string[] } {
  const extracted = extractJsonObject(text);
  if ('error' in extracted) return { errors: [extracted.error] };
  let stack: Stack;
  try { stack = validateStack(extracted.value); }
  catch (e) { return { errors: schemaErrors(e) }; }              // ValidationError.errors → "Schema: <path> <message>"
  const errors = checkIntegrity(stack);
  for (const site of scriptsOf(stack)) {
    try { parse(site.script); }
    catch (e) { errors.push(`${site.where}: ${messageOf(e)}`); } // NecroTalkError message keeps "Line N: …"
  }
  return errors.length ? { errors } : { stack };
}
```

Schema errors are capped at 20 lines (ajv `allErrors` can emit hundreds for one bad `oneOf`), deduplicated; total
errors are capped at `LIMITS.errors` with a final `…and N more`. `previous` is truncated to `LIMITS.previous`.
The pipeline does not rewrite ids, names or metadata, so the PBT can assert deep equality; the stack loads as
returned (open question 11).

PBT generators: `fixtureShapedStack` starts from the three fixtures and varies names, field text, rects (inside the
card), button styles and which valid scripts (drawn from the fixtures' scripts and `GRAMMAR_EXAMPLES`) sit on which
owners, with fresh valid unique ids. `oneBroken` picks one site and replaces one line of its script with a line from
a bad-line pool (`  sort lines of x`, `  do "beep"`, `  go to`, `end click`), recording the expected line number from
`parse`'s own error so the test does not re-implement the parser.

## Transports

```ts
export interface TransportReply { text: string; remaining?: { day: number; ip: number } }
export type TransportErrorKind = GeminiErrorKind | 'cap' | 'bad_request' | 'not_configured' | 'forbidden';
export class TransportError extends Error { constructor(readonly kind: TransportErrorKind, message: string) }
export interface Transport { readonly path: 'server' | 'direct'; send(r: SummonRequest, signal?: AbortSignal): Promise<TransportReply> }
```

`createServerTransport(apiBase)`: `apiBase` from `import.meta.env.VITE_API_URL ?? ''`, read in `src/main.ts` (not in
`src/summon/`, so the server never sees `import.meta.env`; `src/vite-env.d.ts` adds the one-line `ImportMetaEnv`
declaration if `vite/client` types are not already referenced). A value without a scheme gets `https://`, and a
trailing `/` is dropped. Client timeout 150 s (cold start about 1 minute plus generation).

`createDirectTransport(() => localStorage.getItem(KEY_STORAGE))`: the reader is injected by `src/main.ts`, so
`src/summon/` does not touch `localStorage` at module load. `KEY_STORAGE = 'necrocard.geminiKey'`. Missing key at
call time → `not_configured`.

## AgentClient and selection

```ts
export function createAgentClient(transportFor: () => Transport): AgentClient;
```

`src/main.ts`:

```ts
const readKey = () => localStorage.getItem(KEY_STORAGE);
const server = createServerTransport(apiBase);
const transportFor = () => (readKey() ? createDirectTransport(readKey) : server);
const agent = createAgentClient(transportFor);
const wake = createWakeState(apiBase);
if (!readKey()) wake.start();        // fire and forget; errors swallowed
```

`createWakeState` exposes `status: 'idle' | 'waking' | 'awake' | 'failed'`, `remainingDay?`, and `whenSettled()`.
The Summon dialog shows `Waking the server…` while `status === 'waking'` and the request is pending; a failed health
check does not block summoning (the summon request itself will wake the service).

## Summon dialog

Chrome native `<dialog>` opened with `showModal()` (same pattern as the Expand dialog, shared via
`src/ui/summon/dialogShell.ts`): the browser traps focus and makes the rest of the page inert. Example prompts:
1. `A two-question quiz about haunted houses with a score field and a Results card.`
2. `A choose-your-own-adventure in a crypt with three rooms and a way out.`
3. `Flashcards for five Halloween words: show the word, click to reveal the meaning, Next and Prev buttons.`

Flow: Summon → disable inputs → `summonStack(prompt, transportFor(), { signal, onProgress })` → success:
`onLoaded(stack)` then close; `SummonError` → `<ul>` of failures (textContent only); `TransportError` → one line;
`AbortError` → idle. Remaining count updates from the last `TransportReply.remaining` (the pipeline exposes the last
reply's `remaining` via `onReply`).

`loadSummoned(stack)` in `src/main.ts`: `loadStack(stack)` (editor reset + `runtime.load`), then `editor.enter()`,
`picker.showCustom(stack.name || 'Summoned stack')`, remove `?stack=`.

`StackPicker.showCustom(name)`: one `option[value="custom"]` whose text is the name; `showUntitled` and `setValue` of
a fixture remove it (mirrors Untitled, no persistence until spec `sharing`).

## Settings dialog

Password input, Test, Save, Clear, Close. Test runs `createDirectTransport(() => pasted).send({ kind: 'explain',
payload: { script: 'on mouseUp\n  beep\nend mouseUp', context: TEST_CONTEXT } })` and reports `Key works` or the
`TransportError` message. Save writes `localStorage`; Clear removes it. Masked display: `•••• abcd`. The pasted value
is never put in the DOM after Save (the input is cleared).

## Server

```ts
export interface ServerConfig {
  apiKey: string | null; model: string; dailyCap: number; perIpCap: number;
  allowedOrigins: readonly string[]; port: number;
}
export interface PlainRequest { method: string; path: string; headers: Record<string, string | undefined>; body: string; ip: string }
export interface PlainResponse { status: number; headers: Record<string, string>; body: string }
export function createHandler(deps: {
  config: ServerConfig; now: () => Date;
  generate: (prompt: BuiltPrompt, signal: AbortSignal) => Promise<string>;   // real: gemini.generate with config key/model
}): (req: PlainRequest) => Promise<PlainResponse>;
```

| Variable | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | — | Secret. Missing → `not_configured`. |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Checked against `^[a-z0-9.-]+$`. |
| `DAILY_CAP` | `100` | Non-negative integer; invalid → default with a startup warning. |
| `PER_IP_CAP` | `10` | Same. |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:5174` | Exact match after trimming; no wildcards. |
| `PORT` | `8787` | Render sets `PORT` itself. |

`main.ts`: reads the body with a running byte count and stops at 64 KiB (413); client IP = first entry of
`X-Forwarded-For` if present, else the socket address (open question 9); the IP is used only as an in-memory map key
and logged truncated (`203.0.x.x`).

### Caps

```ts
createCaps(dailyCap, perIpCap) → {
  remaining(ip, now): { day, ip };
  consume(ip, now): { ok: true; remaining } | { ok: false; remaining; reason: 'day' | 'ip' };
}
```

State: `{ day: 'YYYY-MM-DD' (UTC), total, perIp: Map<string, number> }`; any call on a new UTC day resets all three.
The map holds at most `dailyCap` entries per day, because only consumed requests add entries.

Counters reset when the process restarts. That is acceptable here because:
- Render's free web service spins down after 15 minutes without traffic and may restart at any time, so any
  in-process state is lost; persisting it would need a database or Key Value instance, which is more infrastructure
  than a hackathon demo justifies.
- The caps are a cost and abuse guard, not a billing system. The hard backstop is Gemini's own free-tier quota on the
  project, which persists across restarts and costs nothing when exhausted (`quota` → 503, a clear message).
- A restart can at most grant one extra day's allowance; an attacker who could force restarts could equally rotate
  IPs. Nothing else (accounts, payments, data) depends on the counts.

### CORS

| Request | Response |
|---|---|
| `OPTIONS` with listed `Origin` | 204, `Allow-Origin: <origin>`, `Allow-Methods: GET, POST, OPTIONS`, `Allow-Headers: Content-Type`, `Max-Age: 600`, `Vary: Origin` |
| GET/POST with listed `Origin` | normal, plus `Allow-Origin`, `Expose-Headers`, `Vary: Origin` |
| Any with unlisted `Origin` | 403 `forbidden`, no CORS headers, not counted |
| No `Origin` | normal, no CORS headers |

No `Allow-Credentials`. CORS stops other websites from using the visitor's browser against the server; it does not
stop scripts, which is what the caps are for.

## Build and dev

`tsconfig.server.json`:

```json
{
  "compilerOptions": {
    "strict": true, "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "resolveJsonModule": true, "outDir": "dist-server", "rootDir": ".", "skipLibCheck": true,
    "types": [], "lib": ["ES2022", "DOM"]
  },
  "include": ["server/**/*.ts"],
  "exclude": ["server/**/*.test.ts"]
}
```

`lib: DOM` provides `fetch`, `Response`, `AbortSignal` types for Node 22's globals without `@types/node`;
`server/node.d.ts` declares only `node:http` (`createServer`, `IncomingMessage`, `ServerResponse`) and `process.env`
/ `process.exitCode`. Output: `dist-server/server/main.js`, `dist-server/src/summon/*.js`, the schema JSON copied by
`resolveJsonModule`.

`package.json` scripts:

```json
"server:build": "tsc -p tsconfig.server.json",
"server:start": "node dist-server/server/main.js",
"server:dev": "npm run server:build && node --env-file-if-exists=.env dist-server/server/main.js",
"typecheck": "tsc --noEmit && tsc -p tsconfig.server.json --noEmit",
"lint": "eslint src server"
```

`--env-file-if-exists` needs Node 22.9+ (the repo requires Node 22+; open question 14). `vite.config.ts` adds
`server: { proxy: { '/api': 'http://localhost:8787' } }` and `server/**/*.test.ts` to the Vitest include. The root
`tsconfig.json` adds `server` to `include` so tests type-check.

`.env.example`:

```
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite
DAILY_CAP=100
PER_IP_CAP=10
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174
PORT=8787
```

### `render.yaml`

> **Superseded by spec `single-service-hosting` (2026-11-04).** The two-service layout below (a static site plus a
> separate `necrocard-api` web service with `ALLOWED_ORIGINS` and `VITE_API_URL`) was replaced by one `necrocard` web
> service that serves the built `dist/` and the `/api` endpoints on one origin. The design below is kept as the
> original record of this spec; for the shipped blueprint, `.env.example`, and the CORS same-origin rule, see
> `.kiro/specs/single-service-hosting/`.

```yaml
services:
  - type: web
    name: necrocard-api
    runtime: node
    plan: free
    buildCommand: npm ci && npm run server:build
    startCommand: npm run server:start
    healthCheckPath: /api/health
    envVars:
      - key: NODE_VERSION
        value: "22"
      - key: GEMINI_API_KEY
        sync: false
      - key: GEMINI_MODEL
        value: gemini-3.5-flash-lite
      - key: DAILY_CAP
        value: "100"
      - key: PER_IP_CAP
        value: "10"
      - key: ALLOWED_ORIGINS
        value: https://necrocard.onrender.com,http://localhost:5173,http://localhost:5174
  - type: web
    name: necrocard
    runtime: static
    buildCommand: npm ci && npm run build
    staticPublishPath: ./dist
    envVars:
      # The hostname changes if the service name necrocard-api is taken on Render.
      - key: VITE_API_URL
        value: https://necrocard-api.onrender.com
```

`npm ci` is added to the static build because a static site's build command must install devDependencies (Vite) itself
(open question 10). `VITE_API_URL` is a literal (not `fromService`), so it does not depend on cross-service variable
references; the service names determine the `onrender.com` hostnames.

## Testing

| File | Covers |
|---|---|
| `src/summon/prompts.test.ts` | REQ-1.5: examples parse, schema equality, determinism, delimiter escaping, `buildPrompt` per kind |
| `src/summon/contract.test.ts` | `parseSummonRequest`: each kind, unknown keys, every limit ±1, bad enums |
| `src/summon/gemini.test.ts` | URL, header key, no key in URL, body per kind, every error kind, abort, timeout, model id check |
| `src/summon/extract.test.ts` | Plain, fenced, prose-wrapped, braces in strings, arrays, garbage |
| `src/summon/integrity.test.ts` | Each rule; owner descriptions; fixtures pass |
| `src/summon/pipeline.test.ts` | REQ-3.3 PBTs; examples for schema failure, transport error not retried, abort, progress order |
| `src/summon/serverTransport.test.ts` | Body, headers, `credentials: 'omit'`, remaining headers, error mapping, scheme-less base |
| `src/summon/directTransport.test.ts` | Key read per call, missing key, same prompt as the server |
| `src/summon/agentClient.test.ts` | Stub unchanged; real client explain/fix, fence stripping, error mapping; no `src/ui` import in any `src/summon` file; no top-level `localStorage`/`window`/`document` |
| `src/summon/wake.test.ts` | One request, remembered, failure silent |
| `server/caps.test.ts` | Day and IP caps, UTC rollover, map bound |
| `server/handler.test.ts` | REQ-9.2 server list |
| `src/ui/summon/*.test.ts` | Dialog states, examples fill, failure list, cancel aborts, settings save/clear/mask/test |
| `src/ui/browse/stackPicker.test.ts` | `showCustom` added, replaced, removed |
| `test/e2e/summon.spec.ts` | REQ-9.3 |

Every e2e spec imports `test` from `test/e2e/apiMock.ts`, whose auto fixture answers `/api/health` and
`/api/summon` as an unconfigured server (no spec needs `server:dev`, and the page-load health check never hits the
Vite proxy's dead target). `summon.spec.ts` registers its own `page.route` handlers, which take precedence. The
script-editor Fix e2e test now expects the server's `Summon is not configured on this server.` instead of the stub's
message.

---

## Open questions (defaults chosen; confirm or override)

1. **Model id.** Confirmed: `gemini-3.5-flash-lite` (stable, Google's named successor of `gemini-2.5-flash`; free
   tier to be confirmed by the first real request in Task 6). Alternative `gemini-3.8-flash` is one env var away.
2. **`responseMimeType` vs `responseFormat`.** Default `generationConfig.responseMimeType` as requested (documented,
   not deprecated). The newer `responseFormat.text.mimeType: "APPLICATION_JSON"` is a later swap if Google deprecates
   the old field.
3. **No response schema.** Default: none. Gemini's structured output supports only a JSON Schema subset, and our
   schema uses `pattern`, `allOf`, `oneOf`, `$ref` and `unevaluatedProperties`; the schema goes in the system
   instruction and `validateStack` is the judge.
4. **Error kinds.** Default `quota | auth | safety | network | upstream` (the extra `upstream` covers 5xx and empty
   replies, which fit none of the four).
5. **JSON contract.** As in the section above: `{kind, payload}` in, `{ok, text}` / `{ok, error:{kind, message}}` out,
   `X-Summon-Remaining-Day` / `X-Summon-Remaining-Ip` headers, `GET /api/health` → `{ok, model, remainingDay}`.
6. **Limits.** Prompt 2000 chars, script 20000, previous 48000, 40 errors × 400 chars, body 64 KiB.
7. **Retry scope.** Default: retry once only for content failures (extract, schema, integrity, parse); transport
   errors (cap, quota, safety, network) fail immediately so a cap is never spent twice on a broken connection.
8. **What counts.** Default: summon, retry, explain and fix each count as one request when they pass validation,
   before Gemini is called, and are not refunded on Gemini failure. A summon therefore costs 1–2. Health, preflight,
   403/400/413 do not count.
9. **Client IP.** Default: first `X-Forwarded-For` entry, else the socket address. It is spoofable by a client that
   sends its own header if Render appends rather than replaces (not verified); the global daily cap bounds the
   damage either way.
10. **Static build command.** The request said `npm run build`; default `npm ci && npm run build` so Vite is
    installed. Revert if you know Render installs dependencies for static sites.
11. **Metadata.** Default: the summoned stack loads exactly as returned (no id or metadata rewrite). Alternative:
    set `created`/`modified` to now and `author` to `Summon` on load.
12. **Images.** Default: Summon must not create image objects (integrity failure → retry); there is no asset
    pipeline for generated images, and `src` data URLs would bloat the reply.
13. **Schema import.** Default `import … with { type: 'json' }` in `prompts.ts`; fallback is a generated
    `schemaText.ts` if TypeScript 6, Vite 8 or Vitest rejects the attribute.
14. **Node version.** `server:dev` uses `--env-file-if-exists` (Node 22.9+). Default: set `engines.node` to
    `>=22.9` and `NODE_VERSION=22` on Render.
15. **BYO key exposure.** The direct path sends the key from the browser to `generativelanguage.googleapis.com`
    (Google allows browser CORS for this endpoint; the e2e tests do not exercise it). Any script running on the page
    can read `localStorage`; acceptable because the site loads no third-party scripts and stacks never run JS. The
    Settings dialog says so in one sentence and recommends a key restricted to the Gemini API.
16. **Interactions API.** Not used: the docs now recommend it, but `generateContent` is the stateless call this
    pipeline needs and is what was requested.
17. **Timeouts and cold start.** Server → Gemini 60 s; browser → server 150 s; direct → Gemini 90 s. The progress
    line shows `Waking the server…` until health succeeds, then `Summoning…`.
18. **Steering.** Task 1 updates `tech.md` and `structure.md`: Render instead of Cloudflare, `server/` instead of
    `src/worker/` (same boundaries: may import `src/model/` and `src/summon/`, no browser APIs), Gemini as provider.
