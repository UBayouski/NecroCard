# sharing — Requirements

## Overview

Persistence and sharing for NecroCard, with no backend: the open stack autosaves to `localStorage`, exports and
imports as a `.necrocard.json` file, and shares by a compressed URL fragment. There is no blob store — the whole
stack rides in the `#` fragment — so `src/share/` depends only on `src/model/` and the Render server is untouched.

This is spec 7 of 8. It builds on `stack-model` (`serializeStack`, `validateStack`, fixtures), `browse-mode` (the
runtime, the status line, the stack picker) and `edit-mode` / `summon` (New Stack, Summon, the custom picker entry).

Sources: `docs/BRIEF.md` section 7 (persistence and sharing); steering `product.md` (autosave, export/import, URL
share) and `structure.md` (`src/share/` imports `src/model/` only). This spec overrides one point of the brief and
product steering on the user's instruction: no serverless blob store. Sharing is by URL fragment only; large stacks
are handled by a length warning and the Export fallback, not a blob id. Task 1 amends `docs/BRIEF.md` section 7 and
`product.md` to match.

### In scope

A pure deflate + base64url codec with a round-trip property test; debounced `localStorage` autosave with a defined
load-priority order; file export and import; a Share dialog with the full URL, Copy, a length warning, and Export /
Import buttons; share-URL loading that clears the fragment; Vitest unit, property and DOM tests; Playwright e2e;
one Playwright MCP run.

### Out of scope

Any server blob store or short-id sharing; multiple named saves or a save slot UI; compression other than
`deflate-raw`; cloud sync or accounts; a diff/merge of autosave against a share URL; any change to `src/interp/`,
`src/model/`, `src/summon/` or `server/`; new dependencies.

---

## REQ-1 — Codec (`src/share/codec.ts`, pure)

### REQ-1.1 — Encode

`encodeStack(stack): Promise<string>` serializes with `serializeStack` (canonical, sorted keys), encodes the UTF-8
bytes, deflates them with `CompressionStream('deflate-raw')`, and base64url-encodes the result (alphabet `A–Z a–z
0–9 - _`, no `=` padding). The output contains only URL-fragment-safe characters.

### REQ-1.2 — Decode

`decodeStack(text): Promise<Stack>` base64url-decodes, inflates with `DecompressionStream('deflate-raw')`, decodes
UTF-8, and returns `validateStack(JSON.parse(...))`. Any failure — bad base64url, a byte that is not valid deflate,
text that is not JSON, or JSON that fails the schema — is caught and re-thrown as a `ShareDecodeError` with a plain
English message. `JSON.parse`'s `SyntaxError` never escapes; neither does a `DecompressionStream` error.

### REQ-1.3 — Portability and no dependency

The module uses only `CompressionStream`, `DecompressionStream`, `TextEncoder`/`TextDecoder`, `Uint8Array` and
base64 primitives available in both the browser and Node 22. It imports only `src/model/`. Streams are injectable in
tests only if needed; the default path uses the globals.

### REQ-1.4 — Round-trip property test (fast-check, ≥ 100 runs)

For any fixture-shaped valid stack, `decodeStack(await encodeStack(stack))` deep-equals the stack. Separately: a
tampered string (a flipped or dropped character) and a truncated string each reject with `ShareDecodeError`, never
with a raw `SyntaxError` or a `DOMException` surfacing to the caller.

---

## REQ-2 — Autosave (`src/share/autosave.ts`)

### REQ-2.1 — Saving

The open stack is written to `localStorage` under one key (`necrocard.autosave`, open question 1) as the canonical
JSON string from `serializeStack`. Autosave captures what the person did, never what a script did. Saves happen:
- after every committed edit in Edit mode (debounced 500 ms, trailing);
- immediately (no debounce) after a stack loads from Summon, import, New Stack, or a fixture choice;
- after the message box runs a statement that mutates the stack, and after the person types into an unlocked field
  in Browse (debounced).

A save does **not** happen after a button-script dispatch, so reloading a stack mid-play (for example a quiz whose
buttons change a score) resumes from the last thing the person authored, not the script's running state: a reload of
the quiz starts it fresh. A pending debounced save is flushed before any immediate save, so the last write always
reflects the latest stack.

### REQ-2.2 — Loading and priority

`chooseInitialLoad(location, storage)` decides what to load on page start, in this order:
1. a share fragment (`#s=…`, open question 2) in the URL;
2. a `?stack=<fixture>` query (an explicit fixture link);
3. the autosaved stack in `localStorage`;
4. the default quiz fixture.

It returns a tagged source (`share`, `fixture`, `autosave`, or `default`) plus the payload needed to load it, so
`src/main.ts` stays declarative.

### REQ-2.3 — Corrupt autosave

A `localStorage` value that is missing, not JSON, or fails validation is ignored: the app falls through to the next
source (the default quiz), shows a one-line status message (`Your saved stack could not be read; opening the sample
stack.`), and never throws. Reading `localStorage` when it is unavailable (privacy mode) also falls through
silently.

### REQ-2.4 — Replacement

New Stack and choosing a fixture replace the open stack and overwrite the autosave with it, as today. There is one
autosave; there is no history of past stacks.

---

## REQ-3 — Export and import (`src/share/file.ts`)

### REQ-3.1 — Export

`exportStack(stack, deps?)` downloads the canonical JSON as `<name>.necrocard.json`, where `<name>` is the stack
name reduced to a safe filename (open question 3: non-safe characters to `-`, empty name → `stack`). It builds a
`Blob` of type `application/json`, an object URL, and a temporary anchor it clicks, then revokes the URL. The anchor
and URL factory are injectable for tests; no real download in unit tests.

### REQ-3.2 — Import

`readStackFile(file): Promise<Stack>` reads the file as text and returns `validateStack(JSON.parse(...))`, re-thrown
as a `ShareImportError` with a plain message on any failure (not JSON, schema invalid, read error). The caller loads
the result into Edit mode with the picker entry showing its name (REQ-4.3), the same path as a summoned stack.

### REQ-3.3 — Import picker

`pickStackFile(): Promise<File | null>` opens a file chooser filtered to `.json` / `application/json` and resolves
with the chosen file or null if cancelled (mirrors `pickImageFile` from edit-mode). Injectable in tests.

---

## REQ-4 — Share dialog and share-URL loading (`src/ui/share/`)

### REQ-4.1 — The dialog

A Share button in the chrome toolbar opens a chrome dialog (the `summon` dialog shell: modal, labelled, focus
trapped, Escape closes) containing:
- a read-only text input holding the full share URL — `origin + pathname + '#s=' + encodeStack(current)`, with no
  query string;
- a Copy button using `navigator.clipboard.writeText`, falling back to selecting the input and `document.execCommand`
  or a manual "select-all, press Ctrl+C" prompt when the Clipboard API is unavailable or rejects;
- the link length in characters, updated when the URL is built;
- a warning, shown above `SHARE_URL_WARN = 8000` characters (open question 4), that very long links may be truncated
  by chat apps and that Export is the safer way to share a big stack;
- Export and Import buttons wired to REQ-3.

Building the URL is async (it encodes); while encoding, the input shows `Building link…` and Copy is disabled. An
encode failure shows a one-line message in the dialog.

### REQ-4.2 — Opening a share URL

On page load, a `#s=<encoded>` fragment (REQ-2.2 priority 1) is decoded with `decodeStack` and loaded in **Browse**
mode **with autosave off** (`loadStack` with `autosave: false`), with the picker entry showing the stack's name (the
custom entry from `summon`). The shared stack is not written to `localStorage` until the visitor makes an edit, so
following someone's link never overwrites the visitor's own saved stack. Then the fragment is cleared with
`history.replaceState` so a reload falls through to the autosave (the visitor's own, still intact). A fragment that
fails to decode shows the status message `That shared link could not be opened; opening the sample stack.` and falls
through to the next source.

### REQ-4.3 — Picker entry

A stack opened from a share URL, an import, or Summon shows the same custom picker entry (`showCustom(name)` from
`summon`). Choosing a fixture or New Stack removes it, as today.

### REQ-4.4 — Chrome only

The dialog uses chrome styling (`retro-ui.md`), the native top-layer `<dialog>`, accessible names on every control,
and does not touch the card surface. The Share button is disabled while the runtime is busy.

---

## REQ-5 — Integration (`src/main.ts`, small hooks)

### REQ-5.1 — Change signal

`EditController` gains an optional `onChange()` called after every successful committed mutation (the `op` path) and
after the message box mutates the stack in Browse. `BrowseRuntime` exposes the live working-copy stack
(`currentStack`). `src/main.ts` wires both to the autosave.

### REQ-5.2 — One load path

Every load (fixture, New Stack, Summon, import, share) goes through the existing `loadStack`, then triggers an
immediate autosave. The initial load uses `chooseInitialLoad`.

### REQ-5.3 — Boundaries

`src/share/` imports only `src/model/`. `src/ui/share/` imports `src/model/`, `src/share/` and the shared dialog
shell. No file imports `src/summon/` internals, `src/interp/` or `server/`. A test enforces the `src/share/`
boundary.

---

## REQ-6 — Testing

### REQ-6.1 — Unit and property (Vitest)

- `codec.test.ts` (node environment): REQ-1.4 round-trip PBT; encode output is base64url only; explicit
  tampered/truncated/empty/garbage cases reject as `ShareDecodeError`; a valid non-stack JSON object rejects with
  the schema message.
- `autosave.test.ts` (happy-dom, fake timers, fake `localStorage`): debounced save coalesces rapid edits into one
  write after 500 ms; immediate save flushes the pending one; `chooseInitialLoad` priority order; corrupt and
  unavailable storage fall through with the status message; a stack loaded from a share URL (autosave off) does not
  write to storage, so a prior autosave survives a reload.
- `file.test.ts` (happy-dom, fake anchor and URL factory): export clicks an anchor with the right `download` name
  and a blob URL that decodes to the stack; `readStackFile` validates and maps errors; `pickStackFile` resolves.
- `shareDialog.test.ts` (happy-dom): the URL input holds `#s=…` with no query; length shown; warning appears only
  past the threshold; Copy uses the clipboard and falls back; Export/Import call their deps.

### REQ-6.2 — End-to-end (Playwright)

`test/e2e/sharing.spec.ts`:
1. Autosave: edit a button's name in Edit mode, reload the page, the edit survives (no `?stack=` or `#`).
2. Share: open the Share dialog, read the URL, open it in a second page; the same stack loads in Browse with the
   same first card; the fragment is gone after load. Then, in that second page, confirm a prior autosave survives:
   with a saved stack already in `localStorage`, opening a share link and reloading restores the saved stack, not
   the shared one.
3. Export: clicking Export triggers a download whose file content decodes (via the codec) to the open stack.
4. Import: importing that file loads the stack in Edit mode with its name in the picker.

### REQ-6.3 — Playwright MCP

One run against the dev server: open the quiz, open the Share dialog, copy the link, open it in a second tab,
confirm the same first card, screenshot `.playwright-mcp/share-opened.png`, read the console.

---

## REQ-7 — Constraints

- No change to `src/interp/`, `src/model/`, `src/summon/` or `server/`; no new dependencies; files under ~300 lines.
- No server blob store; the stack travels only in the URL fragment.
- No `eval`, `new Function` or `innerHTML` in new code; the share URL and decoded stacks are treated as untrusted
  (validated before load, never executed).
