# NecroCard

**HyperCard, raised from the dead.** Describe a stack in plain English and NecroCard builds the cards, buttons, fields,
and HyperTalk-style scripts. Then click through it, edit it, and share it by URL.

Built for **Kiroween 2026**, category **Resurrection**, with [Kiro](https://kiro.dev).

> Live at **[necrocard.onrender.com](https://necrocard.onrender.com)**.

## What it is

HyperCard (1987 to 2004) let anyone build interactive software by stacking cards, dropping buttons and fields onto
them, and writing small English-like scripts. NecroCard brings that model back in the browser and adds the one thing
1987 did not have: an agent that writes the stack for you from a sentence.

- **Stacks, backgrounds, cards.** Objects: buttons, fields, images. Each has properties and a script.
- **NecroTalk.** A frozen subset of HyperTalk: handlers, navigation, `put`/`get`/`set`, `if`/`repeat`, `answer`/`ask`,
  visual effects.
- **Summon.** Type a description, get a working stack with scripts. Explain and fix scripts in the editor.
- **Share.** Save locally, export JSON, or share a stack by URL.
- **Look.** 1-bit Macintosh: classic Mac-style bitmap fonts, dither patterns, bevelled buttons, dissolve transitions.

## Fonts

The three bundled bitmap-style fonts, their designers and their licenses (SIL Open Font License 1.1) are listed in
[`src/assets/fonts/FONTS.md`](src/assets/fonts/FONTS.md).

## Run

Requires Node 22.9 or later.

```
npm install
npm run dev        # http://localhost:5173
```

The three sample stacks work with no server and no AI calls. Other commands: `npm test` (unit and property tests),
`npm run build`, `npm run e2e` (Playwright), `npm run typecheck`, `npm run lint`.

## Running Summon locally

Summon, Explain and Fix call Google Gemini through a small Node server in `server/`. The app works without it: the
sample stacks need no AI calls.

1. Get a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey).
2. Copy `.env.example` to `.env` and set `GEMINI_API_KEY`. `.env` is ignored by git; never commit it.
3. Start the server: `npm run server:dev` (builds to `dist-server/` and listens on port 8787; Node 22.9+).
4. Start the app in a second terminal: `npm run dev`. Vite proxies `/api` to `http://localhost:8787`.

Check the server with `GET http://localhost:8787/api/health`: `"ok": true` means a key is set. The server caps
requests per UTC day (`DAILY_CAP`, default 100) and per IP (`PER_IP_CAP`, default 10); the counters live in memory
and reset when it restarts. Alternatively, paste your own key in the app's Settings: it stays in this browser's
local storage and is sent only to Google.

## Deploying to Render

`render.yaml` is a Render Blueprint with two services:

- `necrocard-api`: a free Node web service (`npm ci && npm run server:build`, `npm run server:start`, health check
  `/api/health`).
- `necrocard`: a static site built with `npm ci && npm run build` and published from `dist`, with `VITE_API_URL`
  pointing at the API service.

In the Render dashboard, create a Blueprint from this repository, then set `GEMINI_API_KEY` on `necrocard-api` (it is
marked `sync: false`, so the key is never stored in the repo). If either service name is taken, Render assigns a
different `onrender.com` hostname: update `VITE_API_URL` and `ALLOWED_ORIGINS` in `render.yaml` to match. The free
web service sleeps after 15 minutes without traffic; the app sends one health request on page load to wake it.

## Built with Kiro

Specs, steering docs, hooks, custom agents, and MCP settings live in [`.kiro/`](.kiro/). The running log of how Kiro
was used during the build is in [`KIRO_USAGE.md`](KIRO_USAGE.md). The full write-up is added before submission.

The Playwright MCP server in `.kiro/settings/mcp.json` is configured for Windows, where `npx` is a script and must
run through `cmd /c`. On macOS or Linux, change `"command"` to `"npx"` and drop `"/c"` and `"npx"` from `args`.

## Disclosure

NecroCard was created from scratch during the Kiroween 2026 submission period (October 30 to December 4, 2026).
It uses standard open source frameworks and libraries only; no other pre-existing code is incorporated.

## License

MIT. See [LICENSE](LICENSE).
