# single-service-hosting — Design

## Module map

```
server/
├── static.ts          # new: createStaticFiles(root) → (method, path) => Promise<StaticResponse>
├── config.ts          # + staticDir: string | null (DEFAULTS.staticDir = 'dist')
├── handler.ts         # + sameOrigin(origin, host); the CORS gate also accepts a host-matched origin
├── main.ts            # routes /api/* to the handler and everything else to createStaticFiles(staticDir)
├── node.d.ts          # + ambient types for node:fs/promises (stat, readFile) and node:path (resolve, extname, sep)
└── fixtures/static/   # new test tree: index.html, favicon.ico, assets/index-abc123.{js,css}
```

Nothing in `src/` changes. `static.ts` imports only `node:fs/promises` and `node:path`; it reads no file under `src/`
and touches no browser global, so the `server/` import boundary in `structure.md` holds. The import graph gains one
leaf: `main.ts` → `static.ts` → `node:fs/promises`, `node:path`.

Why one process instead of two: Render's free plan gives one always-reachable web service per blueprint; a second
static site is a second service to name, wake and keep in sync, and it forces CORS and a `VITE_API_URL` across the two
origins. Folding the static files into the API process removes both: one origin, no allow-list, one cold start. The
cost is that the Node process serves bytes Vite could serve from a CDN edge; for a hackathon demo that is nothing, and
Vite's hashed-asset `immutable` caching still lets the browser cache everything after the first load.

---

## Static response shape

```ts
export interface StaticResponse { status: number; headers: Record<string, string>; body: Uint8Array }
export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
export const CACHE_REVALIDATE = 'no-cache';
export function createStaticFiles(root: string): (method: string, path: string) => Promise<StaticResponse>;
```

`body` is `Uint8Array`, not `string`, because assets are binary (fonts, PNGs, the favicon); `server/node.d.ts`'s
`ServerResponse.end` is widened to `string | Uint8Array` so `main.ts` can write it.

## Request flow in `createStaticFiles`

1. Method: upper-case; anything but `GET`/`HEAD` → `text(405, …, { Allow: 'GET, HEAD' })`.
2. `pathname = path.split('?')[0].split('#')[0]`, then `decodeURIComponent`. A decode throw → `400`. A `\0` in the
   result → `400`.
3. Ensure a leading `/`; a trailing `/` appends `index.html`.
4. `file = resolve(base, '.' + pathname)`. Containment: `file === base || file.startsWith(base + sep)`. Outside →
   `404`. Resolving against `base` with a leading `.` means `..` segments that climb above `base` fail this test; the
   decode in step 2 means encoded `..` is caught too.
5. Read `file`. If it is a file, serve it. If not and `extname(pathname) === ''` (a page route), serve
   `resolve(base, 'index.html')`; if that too is missing → `404`. A missing path with an extension → `404`.
6. Caching: `hashed = servedThePathItself && pathname.startsWith('/assets/')` → `CACHE_IMMUTABLE`, else
   `CACHE_REVALIDATE`. The fallback `index.html` is never `immutable` even when the original path was under
   `/assets/`, because `served !== file` in that case.
7. Media type from `TYPES[extname(served).toLowerCase()] ?? 'application/octet-stream'`. `Content-Length` is the body
   byte length. `HEAD` returns the headers with a zero-length body.

```ts
async function fileAt(path: string): Promise<Uint8Array | null> {
  try { return (await stat(path)).isFile() ? await readFile(path) : null; }
  catch { return null; }   // ENOENT, EACCES, a directory, a dangling symlink → treated as absent → 404
}
```

A `stat` that resolves to a non-file (a directory, a device) returns `null`, so `fileAt` treats it as absent and
nothing is ever listed. What that means for a directory path depends on the trailing slash. A path with a trailing
slash (`/assets/`) had `index.html` appended in step 3, so it is served only if that index exists and is `404`
otherwise. A path with no trailing slash (`/assets`) has no extension, so step 5 reads it, finds it is not a file,
and takes the page-route fallback to `index.html` — a `200`, not a `404`. A symlink is followed by `stat`/`readFile`;
the containment check is on the request path, not the link target, so a symlink inside `root` that points outside
still serves its target — acceptable because `dist/` is produced by Vite and contains no symlinks (noted, not
defended further; out of scope).

## Config

```ts
export interface ServerConfig {
  apiKey: string | null; model: string; dailyCap: number; perIpCap: number;
  allowedOrigins: readonly string[]; port: number;
  staticDir: string | null;   // app directory served on non-/api paths; null = API only
}
export const DEFAULTS = { /* … */ staticDir: 'dist' } as const;

// in readConfig:
staticDir: env.STATIC_DIR === undefined ? DEFAULTS.staticDir : env.STATIC_DIR.trim() || null,
```

Unset → `dist` (the common case, including Render, which does not set `STATIC_DIR`). Set and non-empty → the trimmed
value. Set to `""` or spaces → `null`, the explicit "API only" switch used by tests and by a split deployment.

## Routing in `main.ts`

```ts
const serveFile = config.staticDir === null ? null : createStaticFiles(config.staticDir);
const isApi = (path: string) => path === '/api' || path.startsWith('/api/');

// per request, path = url.split('?')[0]:
if (isApi(path)) {
  const { body, tooLarge } = await readBody(req);           // 64 KiB limit, unchanged
  const response = await handle({ method, path: url, headers: plainHeaders(req.headers), body, bodyTooLarge: tooLarge, ip });
  res.writeHead(response.status, response.headers); res.end(response.body);
} else if (serveFile) {
  req.resume();                                             // drain the body; static serving ignores it
  const response = await serveFile(method, url);
  res.writeHead(response.status, response.headers); res.end(response.body);
} else {
  req.resume();
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('Not found.');
}
```

The handler is passed the full `url` (query intact) exactly as before; the static server is passed the full `url` and
strips the query itself. `req.resume()` before static serving avoids leaving an unread request body on the socket.

Logging: `if (isApi(path)) console.log(\`${method} ${path} ${status} ${kind} ${…}ms ${maskIp(ip)}\`)`. Static requests
are silent so a single page load (dozens of asset requests) does not bury the API log. The startup line gains
`app ${config.staticDir ?? 'off'}`.

## CORS: host-matched origin

```ts
// handler gate, replacing the single-condition check:
if (origin !== undefined && !config.allowedOrigins.includes(origin) && !sameOrigin(origin, req.headers.host)) {
  return json(403, {}, failure('forbidden', MESSAGES.forbidden));
}

function sameOrigin(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  const lower = origin.toLowerCase();
  return lower === `https://${host.toLowerCase()}` || lower === `http://${host.toLowerCase()}`;
}
```

The match is exact scheme + host, so `https://necrocard.onrender.com` is accepted on that host while
`https://necrocard.onrender.com.evil.example` (different host) and `https://evil.example/necrocard.onrender.com` (the
host string as a path) are not — both are tested. The echoed `Access-Control-Allow-Origin` is the request's own
`Origin`, as before. This relaxation only ever matches the browser that loaded the page from this service, which is
precisely the caller CORS is meant to allow; cross-site callers still need to be in `ALLOWED_ORIGINS`.

Rationale: with one origin, listing the production hostname in `ALLOWED_ORIGINS` is both redundant and brittle (the
name changes if `necrocard` is taken on Render). Trusting `Origin == Host` removes the list from the critical path
while keeping the guard for genuinely cross-origin callers.

## `render.yaml`

```yaml
# Render Blueprint: one free Node web service serves the built app (dist/) and the Summon API.
services:
  - type: web
    name: necrocard
    runtime: node
    plan: free
    buildCommand: npm ci && npm run build && npm run server:build
    startCommand: npm run server:start
    healthCheckPath: /api/health
    envVars:
      - { key: NODE_VERSION, value: "22" }
      - { key: GEMINI_API_KEY, sync: false }
      - { key: GEMINI_MODEL, value: gemini-3.5-flash-lite }
      - { key: DAILY_CAP, value: "100" }
      - { key: PER_IP_CAP, value: "10" }
      # The app and the API share this service's origin, so no ALLOWED_ORIGINS or VITE_API_URL is needed:
      # the server accepts any Origin that matches its own Host header.
```

The build now runs `npm run build` (the app) before `server:build` (the server). `STATIC_DIR` is unset, so the server
defaults to `dist/`. `server:start` runs `node dist-server/server/main.js`, and `dist/` is present from the build.

## `.env.example`

```
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite
DAILY_CAP=100
PER_IP_CAP=10
# Extra origins allowed by CORS, comma-separated. An Origin that matches the server's own Host is always allowed.
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174
PORT=8787
# Directory of the built app (`npm run build`) served on every non-/api path. Set it empty to serve the API only.
STATIC_DIR=dist
```

`ALLOWED_ORIGINS` stays for local development (the Vite dev server on `:5173`/`:5174` is a different origin from the
API on `:8787`) and for a split deployment; in production the host match covers the single origin.

## Local production layout

`npm run build` writes `dist/`; `npm run server:dev` builds and starts the server, which now also serves `dist/` on
`http://localhost:8787`. Opening that URL exercises the exact production routing (one origin, no Vite proxy), which
`npm run dev` (Vite on `:5173` proxying `/api` to `:8787`) does not. Both remain valid: `dev` for fast HMR work,
`server:dev` + `build` for a production-shaped check.

## `node.d.ts` additions

```ts
declare module 'node:http' { /* … */ interface ServerResponse { end(body?: string | Uint8Array): this } }
declare module 'node:fs/promises' {
  export interface Stats { isFile(): boolean; isDirectory(): boolean }
  export function stat(path: string): Promise<Stats>;
  export function readFile(path: string): Promise<Uint8Array>;
}
declare module 'node:path' { export const sep: string; export function resolve(...p: string[]): string; export function extname(p: string): string }
```

Still no `@types/node`: adding it would change `src/`'s browser globals (summon design). Only the handful of members
the server uses are declared.

## Testing

| File | Covers |
|---|---|
| `server/static.test.ts` | REQ-1.7 over `server/fixtures/static/`: methods, SPA fallback, caching, media types, escapes, bad encoding, NUL, HEAD/405, missing root |
| `server/config.test.ts` | REQ-2.1: default `dist`, trimmed value, empty/whitespace → `null`, and the existing full-read case extended with `STATIC_DIR` |
| `server/handler.test.ts` | REQ-4.3: host-matched origin allowed with an empty allow-list; three near-miss origins forbidden; the existing CORS and no-origin cases unchanged |

No unit test opens a socket or makes a network call. `render.yaml` is reviewed by eye against Render's Blueprint spec
(no YAML parser in the repo). The six-check battery (`typecheck`, `lint`, `test`, `build`, `server:build`, `e2e`) plus
a manual curl smoke test against `npm run server:start` with `STATIC_DIR=dist` and no key confirm the whole path:
`/api/health` → 200 `ok:false`, `/` and a page route → 200 HTML `no-cache`, a hashed asset → 200 `immutable`, an escape
and a missing asset → 404, `POST /api/summon` → 503 `not_configured`.

---

## Open questions (defaults chosen; confirm or override)

1. **Default `STATIC_DIR`.** Default `dist` so Render and `server:dev` need no extra variable. Alternative: default
   `null` (API only) and set `STATIC_DIR=dist` explicitly on Render — rejected as more config for the common case.
2. **Symlinks.** Not defended: `dist/` is Vite output and has no symlinks; the containment check is on the request
   path, not the resolved link target. If a symlinked `dist/` is ever used, add an `fs.realpath` containment check.
3. **Compression and validators.** No gzip/brotli, ETag or Last-Modified. Render's free plan and the demo's size make
   them unnecessary; hashed-asset `immutable` caching already avoids refetches. A later spec can add them if needed.
4. **Keeping the split layout.** `ALLOWED_ORIGINS` and `VITE_API_URL` still work, so a two-origin deployment is
   possible, but the blueprint ships one service. Documented, not tested.
5. **404 body.** Plain text `Not found.` for both the static 404 and the API-off 404. No custom HTML 404 page; the SPA
   fallback already handles every in-app route, so a 404 only reaches a genuinely missing asset.
