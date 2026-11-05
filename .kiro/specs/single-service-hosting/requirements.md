# single-service-hosting — Requirements

## Overview

NecroCard ships as one free Render web service instead of two. The same Node 22 `node:http` process that answers
`/api/*` (Summon, health, caps) also serves the built app (Vite's `dist/`) on every other path. App and API share one
origin, so production needs no CORS allow-list and no `VITE_API_URL`: the app calls `/api` relative to the page, and
the server trusts any `Origin` that matches its own `Host`.

This is spec 12. It builds on `summon` (spec 6: `server/config.ts`, `caps.ts`, `handler.ts`, `main.ts`, the CORS
rules, the JSON contract, `render.yaml`, `.env.example`) and does not touch `src/`. It supersedes the summon spec's
two-service Render layout (summon REQ-6 and its `render.yaml`); the summon design and tasks carry a dated note pointing
here rather than being rewritten.

Sources: the user's single-service request; the existing `summon` spec and `server/`; steering `tech.md` (Backend,
Hosting), `structure.md` (`server/` boundary, directory layout), `product.md` (free demo through Jan 29, 2027);
`docs/BRIEF.md` section 9 (technical choices).

### In scope

A pure static-file server (`server/static.ts`) with SPA fallback, correct media types and caching, and path-escape
defence; a `STATIC_DIR` config knob; routing in `server/main.ts` (`/api/*` to the handler, everything else to the
static server, API-only when the app is turned off); a same-origin relaxation of the CORS check in `server/handler.ts`
so an unlisted `Origin` matching the `Host` is allowed; a one-service `render.yaml`; updated `.env.example`, steering
and README; Vitest unit tests for the static server and the new CORS case.

### Out of scope

Any change to `src/`; any new dependency; a blob store or share server (spec `sharing`); HTTPS termination, HTTP/2,
range requests, gzip/brotli negotiation, ETag/Last-Modified, or directory listings; serving anything outside
`STATIC_DIR`; a reverse proxy or CDN in front of Render; keeping the two-service layout as a supported production mode
(a split deployment still works through `ALLOWED_ORIGINS`/`VITE_API_URL`, but it is not what the blueprint ships).

---

## REQ-1 — Static file server (`server/static.ts`, pure)

### REQ-1.1 — Factory and signature

`createStaticFiles(root)` returns an async `(method, path) => StaticResponse` where
`StaticResponse = { status, headers: Record<string, string>, body: Uint8Array }`. It is a plain function in, plain
response out, like `createHandler`; it opens no sockets and reads no globals, so unit tests call it directly. `root`
is resolved once to an absolute base.

### REQ-1.2 — Methods

`GET` and `HEAD` are served; `HEAD` returns the same status and headers as `GET` (including `Content-Length`) with an
empty body. Any other method is `405` with `Allow: GET, HEAD`.

### REQ-1.3 — Path handling and SPA fallback

The query and fragment are stripped, the path is `decodeURIComponent`-decoded, a leading `/` is ensured, and a
trailing `/` appends `index.html`. If the decoded path resolves to a file under `root`, that file is served. If it
does not resolve to a file and has no extension (a client-side route such as `/stacks/quiz`), `index.html` is served
so the app owns its routes. A missing path that has an extension is `404`.

### REQ-1.4 — Caching and media types

Files served from under `/assets/` (Vite hashes their names) get `Cache-Control: public, max-age=31536000, immutable`.
Everything else, including the SPA-fallback `index.html`, gets `Cache-Control: no-cache` (revalidate). `Content-Type`
comes from a fixed extension map covering the types Vite emits (`.html .js .mjs .css .json .map .webmanifest .txt .svg
.png .jpg .jpeg .gif .webp .ico .woff .woff2 .wasm`); an unknown extension is `application/octet-stream`. Every
response carries a correct `Content-Length`.

### REQ-1.5 — Safety

A decoded path that escapes `root` (`..` segments, encoded `..`, absolute-looking input) is `404`, never served. A
path that fails to decode, or contains a NUL byte, is `400`. The fallback never serves `index.html` for a path that
escaped `root`.

### REQ-1.6 — Missing root

If `root` does not exist, every request is `404` (the server still runs for the API; the app is simply absent). A
directory with no `index.html` requested as a directory is `404`.

### REQ-1.7 — Tests (Vitest, `server/static.test.ts` over `server/fixtures/static/`)

A fixture tree (`index.html`, `favicon.ico`, `assets/index-abc123.js`, `assets/index-abc123.css`) proves: `/` serves
`index.html` with `no-cache` and a matching `Content-Length`; hashed assets are `immutable` with the right media type;
a non-`/assets/` file is revalidated; an extensionless and a percent-encoded page path fall back to `index.html`; a
missing file with an extension and a directory without `index.html` are `404`; `..` / encoded-`..` escapes are `404`;
a bad percent-encoding and a NUL byte are `400`; `HEAD` has headers and no body while `POST` is `405` with `Allow`; a
missing root serves nothing.

---

## REQ-2 — Config (`server/config.ts`)

### REQ-2.1 — `STATIC_DIR`

`ServerConfig` gains `staticDir: string | null`. The default is `dist`. An unset `STATIC_DIR` uses the default; a set
value is trimmed; an explicitly empty or whitespace-only value is `null`, which turns the app off and serves the API
only. `readConfig` tests cover the default, a trimmed value, and empty/whitespace → `null`.

---

## REQ-3 — Routing and the one process (`server/main.ts`)

### REQ-3.1 — One server, two roles

A request to `/api` or a path under `/api/` goes to the Summon handler exactly as before (body read with the 64 KiB
limit, `PlainRequest` built, `PlainResponse` written). Every other path goes to the static server when
`config.staticDir` is set; the request body is drained (`req.resume()`) first. When `staticDir` is `null`, a non-API
path is a plain `404`.

### REQ-3.2 — Logging

Only `/api/*` requests are logged (one line: method, path, status, kind, duration, masked IP, as summon REQ-5.7).
Static requests are not logged, so a page load does not flood the log. No prompts, scripts, keys or full IPs appear in
any line.

### REQ-3.3 — Startup line

The startup line reports the app directory (`app dist` or `app off`) alongside model, key presence, caps and origins.

---

## REQ-4 — Same-origin CORS (`server/handler.ts`)

### REQ-4.1 — Host-matched origin

An incoming `Origin` is accepted when it is in `ALLOWED_ORIGINS` (unchanged) **or** it equals `http://<Host>` or
`https://<Host>` for the request's own `Host` header (exact scheme + host, case-insensitive). Because this process
serves the page, the browser's own `Origin` always matches the `Host`, so production needs no allow-list. A request
with no `Host` is not matched this way.

### REQ-4.2 — Everything else unchanged

An `Origin` that is neither listed nor host-matched is still `403 forbidden` with no CORS headers and is not counted. A
request with no `Origin` (health checks, curl) is still served without CORS headers. Allowed responses still carry
`Access-Control-Allow-Origin`, `Vary: Origin` and the expose-headers. Preflight behaviour is unchanged.

### REQ-4.3 — Test

A handler test with an empty `ALLOWED_ORIGINS`: an `Origin` of `https://<host>` matching the `Host` is `200` and gets
that origin echoed back; `https://evil.example`, `https://<host>.evil.example` and `https://evil.example/<host>` are
each `403`.

---

## REQ-5 — Deployment and docs

### REQ-5.1 — `render.yaml`

One `type: web` service named `necrocard`, Node, free plan. Build `npm ci && npm run build && npm run server:build`;
start `npm run server:start`; health check `/api/health`. Env: `NODE_VERSION`, `GEMINI_API_KEY` (`sync: false`),
`GEMINI_MODEL`, `DAILY_CAP`, `PER_IP_CAP`. No `ALLOWED_ORIGINS` or `VITE_API_URL`: a comment records that the app and
API share this service's origin and the server accepts any `Origin` matching its `Host`. The former static service is
removed.

### REQ-5.2 — `.env.example`

Documents `STATIC_DIR=dist` and rewords the origins line to "Extra origins allowed by CORS … An Origin that matches
the server's own Host is always allowed."

### REQ-5.3 — Steering and README

`tech.md` (Backend, Hosting), `structure.md` (`server/` comment, `render.yaml` comment), `docs/BRIEF.md` section 9 and
`README.md` describe one web service that serves the built app and the Summon API on one origin. The README's
"Deploying to Render" section lists the single service and the one secret, notes the free-plan cold start, and gives
the local production-layout recipe (`npm run build`, then `npm run server:dev`, open `http://localhost:8787`).

---

## REQ-6 — Constraints

- No change to `src/`; no new dependency; no SDK; no `eval`, `new Function` or `innerHTML`.
- `server/static.ts` imports only `node:fs/promises` and `node:path` and reads nothing under `src/`, so the
  `structure.md` `server/` boundary is unchanged.
- The server never serves a file outside `STATIC_DIR`, never follows a symlink out of it, and never lists a directory.
- The key is never placed in a URL, a log line, or any response.
- Files stay under ~300 lines; one primary export per file where practical.
