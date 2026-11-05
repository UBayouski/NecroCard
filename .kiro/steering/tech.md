# NecroCard — Technical Steering

## Stack

- **Language**: TypeScript (strict mode). No JavaScript files in `src/`.
- **Bundler**: Vite. Single `npm run dev`, `npm test`, `npm run build`, `npm run e2e`.
- **Runtime**: Node 22+.
- **UI framework**: none. DOM rendering for cards and objects. CSS for the 1-bit look.
- **Backend**: one small Node 22 `node:http` server in `server/` (Render free web service) for Summon, and later share
  blobs. The same process serves the built app from `dist/` on every non-`/api` path (`server/static.ts`).
- **Hosting**: one Render web service for both the app and the API, defined in `render.yaml`. One origin, so no CORS
  allow-list or `VITE_API_URL` in production.
- **AI provider**: Google Gemini through the Google AI Studio REST API (`generateContent`), called with `fetch` from
  the server and, with a bring-your-own key, from the browser. No AI SDKs.

## Hard constraints

| Rule | Rationale |
|---|---|
| **No `eval`** | NecroTalk scripts are interpreted by the hand-written evaluator. `eval` bypasses all validation and opens security holes. |
| **No UI framework** | React, Vue, Svelte, etc. are out of scope. Pure DOM + CSS only. |
| **No HyperCard `.stack` parser** | Binary format support is a non-goal. |
| **Lossless serialization** | Every round-trip of the stack JSON must be identity. Add tests to prove it. |

## Interpreter architecture

The NecroTalk interpreter must be structured as three independent phases:

1. **Tokenizer** — produces a flat token stream; no context required.
2. **Recursive-descent parser** — consumes tokens and produces an AST. Must be usable standalone (PBT target).
3. **Tree-walking evaluator** — walks the AST, never calls `eval`.

Each phase is its own module. The evaluator imports the AST types; it does not import the tokenizer or parser at runtime.

## Testing

| Tool | Use |
|---|---|
| **Vitest** | Unit tests for all modules. Co-locate `*.test.ts` files next to source. |
| **fast-check** | Property-based tests for the interpreter: parse→print→parse round-trip, `put`/read invariant, navigation range invariant, serialization round-trip identity. |
| **Playwright** | End-to-end tests for browse mode, edit mode, and Summon flow. |

Run unit and PBT tests with `npm test` (single-run, no watch in CI). Run e2e with `npm run e2e`.

## Dependencies

- Prefer zero or minimal external dependencies. Every new dependency must be justified.
- Pin exact versions (no `^` or `~` ranges in `package.json`).
- Do not add UI component libraries, state-management libraries, or CSS-in-JS tools.

## Commands

```
npm run dev      # Vite dev server
npm test         # Vitest --run (unit + PBT)
npm run build    # Vite production build
npm run e2e      # Playwright end-to-end
npm run typecheck  # tsc --noEmit
npm run lint     # ESLint
```

## Hooks (planned)

- Vitest on save for `src/**`.
- Typecheck + lint before agent finishes a task.
- Regenerate sample stack fixtures when the schema spec changes.
- Playwright smoke after UI tasks.

## MCP

- Playwright MCP drives the editor and takes screenshots during UI work.
- GitHub MCP for issues if useful during the hackathon.
