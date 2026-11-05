# single-service-hosting — Tasks

Execute in order. Each task is independently verifiable. Do not start a task until the previous one passes its
acceptance check. Every task ends with `npm run typecheck`, `npm run lint` and `npm test` green. No task modifies
`src/`, no task adds a dependency, and no unit test makes a real network call.

---

## Task 1 — Static file server

**Steps:**
1. `server/static.ts`: `StaticResponse`, `CACHE_IMMUTABLE`, `CACHE_REVALIDATE`, `createStaticFiles(root)` per the
   design (methods, decode and NUL guards, containment, SPA fallback, caching, media-type map, HEAD).
2. `server/node.d.ts`: ambient types for `node:fs/promises` (`stat`, `readFile`, `Stats`) and `node:path` (`resolve`,
   `extname`, `sep`); widen `ServerResponse.end` to `string | Uint8Array`.
3. `server/fixtures/static/`: `index.html` (contains "fixture index"), `favicon.ico`, `assets/index-abc123.js`
   (contains "fixture asset"), `assets/index-abc123.css`.
4. `server/static.test.ts` (REQ-1.7): the full matrix against the fixture tree.

**Acceptance:** tests green; `static.ts` imports only `node:fs/promises` and `node:path`; no `src/` import.

---

## Task 2 — Config knob

**Steps:**
1. `server/config.ts`: add `staticDir: string | null` to `ServerConfig`, `DEFAULTS.staticDir = 'dist'`, and the
   `readConfig` rule (unset → default, trimmed, empty/whitespace → `null`).
2. `server/config.test.ts`: the `STATIC_DIR` cases and the extended full-read case.

**Acceptance:** tests green; the default read yields `staticDir: 'dist'`.

---

## Task 3 — Routing in main.ts

**Steps:**
1. `server/main.ts`: build `serveFile` from `config.staticDir`; `isApi(path)`; route `/api/*` to the handler and
   every other path to `serveFile` (drain the body first), or a plain `404` when the app is off.
2. Log only `/api/*` requests; add `app <dir|off>` to the startup line.

**Acceptance:** `npm run server:build` exits 0; starting the server locally with `STATIC_DIR=dist` prints
`app dist` and serves `/` and `/api/health`.

---

## Task 4 — Same-origin CORS

**Steps:**
1. `server/handler.ts`: add `sameOrigin(origin, host)` and extend the CORS gate to accept a host-matched origin in
   addition to `ALLOWED_ORIGINS`.
2. `server/handler.test.ts` (REQ-4.3): host-matched origin allowed with an empty allow-list; three near-miss origins
   forbidden; existing CORS and no-origin cases unchanged.

**Acceptance:** tests green; an unlisted `Origin` equal to `https://<Host>` is `200`, and the three near-misses are
`403`.

---

## Task 5 — Blueprint, env and docs

**Steps:**
1. `render.yaml`: one `necrocard` web service; build `npm ci && npm run build && npm run server:build`; no
   `ALLOWED_ORIGINS`/`VITE_API_URL`, with the same-origin comment. Remove the former static service.
2. `.env.example`: `STATIC_DIR=dist` and the reworded origins comment.
3. Steering: `tech.md` (Backend, Hosting), `structure.md` (`server/` comment, `render.yaml` comment); `docs/BRIEF.md`
   section 9. README "Deploying to Render": one service, one secret, cold-start note, local production recipe.

**Acceptance:** `npm run build` and `npm run server:build` succeed; `render.yaml` reviewed against the design and
Render's Blueprint spec; steering diffs limited to the hosting model.

---

## Task 6 — Final verification

**Steps:**
1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run server:build`, `npm run e2e` — all
   exit 0.
2. `git status -- src` is clean; `package.json` dependencies and devDependencies unchanged.
3. Curl smoke test against `npm run server:start` with `STATIC_DIR=dist` and no key: `/api/health` → 200
   `{ ok: false }`; `/` and a page route (`/stacks/quiz`) → 200 `text/html` `no-cache`; a hashed `/assets/*` → 200
   `immutable`; `/../package.json` and a missing hashed asset → 404; `POST /api/summon` (valid body) → 503
   `not_configured`.
4. Grep new code for `eval(`, `new Function`, `innerHTML`; confirm `server/static.ts` imports nothing from `src/`.

**Acceptance:** all checks pass; the curl smoke test matches the expected statuses, media types and cache headers.
