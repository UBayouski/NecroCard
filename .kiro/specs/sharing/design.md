# sharing — Design

## Module map

```
src/share/
├── codec.ts       # encodeStack / decodeStack, ShareDecodeError, base64url helpers
├── autosave.ts    # createAutosave(storage), chooseInitialLoad(location, storage), AUTOSAVE_KEY
└── file.ts        # exportStack, readStackFile, pickStackFile, ShareImportError
src/ui/share/
├── shareDialog.ts # ShareDialog (Share button host; URL, Copy, length, warning, Export/Import)
└── share.css      # a few rules on top of summon.css (reuses .summon-dialog)
```

Two implementation notes: `chooseInitialLoad` recognises `?stack=` fixture keys with a small local list in
`autosave.ts` (`quiz`, `adventure`, `flashcards`) instead of importing the picker, so `src/share/` keeps its
src/model-only boundary; and `src/main.ts` collapses the summon, import and share "load in Edit under its own name"
paths into one `loadNamedInEdit`.

`src/main.ts` wires the autosave, the initial load and the dialog. `src/ui/edit/editor.ts` gains `onChange`;
`src/ui/browse/runtime.ts` gains `currentStack`. The share dialog reuses `createDialogShell` and `chromeButton`
from `src/ui/summon/dialogShell.ts`.

Import graph: `src/share/*` → `src/model/` only. `src/ui/share/shareDialog.ts` → `src/share/`, `src/model/`,
`src/ui/summon/dialogShell.ts`. No `src/summon/`, `src/interp/` or `server/` import anywhere in `src/share/`.

---

## Codec

```ts
export class ShareDecodeError extends Error {}           // name = 'ShareDecodeError'
export async function encodeStack(stack: Stack): Promise<string>;
export async function decodeStack(text: string): Promise<Stack>;
```

Pipeline:

```
encode: Stack --serializeStack--> JSON string --TextEncoder--> bytes
        --deflate-raw--> bytes --base64url--> fragment text
decode: text --base64url^-1--> bytes --inflate-raw--> bytes
        --TextDecoder--> JSON string --JSON.parse + validateStack--> Stack
```

- **Compression.** `new CompressionStream('deflate-raw')` and `DecompressionStream('deflate-raw')`, driven through a
  `Response(stream).arrayBuffer()` helper so there is no manual reader loop:

  ```ts
  async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
    const writer = stream.writable.getWriter();
    // Attach catch handlers so a bad link rejects once, through arrayBuffer below, and never as an
    // unhandled rejection: a DecompressionStream error rejects both the write/close promises and the
    // readable, and we only await the readable.
    void writer.write(bytes).catch(() => {});
    void writer.close().catch(() => {});
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  }
  ```
  `deflate-raw` (not `deflate` or `gzip`) drops the zlib/gzip header, so it is the shortest and is symmetric across
  browser and Node 22. Both globals exist in Node 22 and current browsers (open question 7: no fallback, no polyfill).

- **base64url.** Build the binary string for `btoa` in chunks of 8192 bytes (`String.fromCharCode(...slice)` per
  chunk, concatenated) rather than spreading the whole array, which overflows the call stack for a stack carrying a
  full-card image. Then `+/=` → `-_` and strip `=`; decode by reversing, with `atob`. `btoa`/`atob` exist in Node
  22's global scope. A regex `^[A-Za-z0-9_-]*$` guards the input before `atob`, so a tampered character is caught as
  `ShareDecodeError` rather than a `DOMException`.

- **Errors.** Every step is inside one `try`; the catch throws `new ShareDecodeError('That shared stack could not be
  read.')` (or `'…is not a valid NecroCard stack.'` when `validateStack` is what failed, so the message is useful).
  The original error is kept on `.cause`.

Round-trip is exact because `serializeStack` is canonical and `decodeStack` returns the parsed object: encode→decode
yields a deep-equal `Stack`, and the PBT asserts it with the same fixture-shaped generator the summon pipeline uses
(shared helper, see Testing).

## Autosave

```ts
export const AUTOSAVE_KEY = 'necrocard.autosave';
export const FRAGMENT_PARAM = 's';                        // #s=<encoded>
export type InitialLoad =
  | { source: 'share'; encoded: string }
  | { source: 'fixture'; key: FixtureName }
  | { source: 'autosave'; stack: Stack }
  | { source: 'default' };
export interface Autosave { save(stack: Stack): void; flush(): void; saveNow(stack: Stack): void }
export function createAutosave(storage: StorageLike, delay?: number): Autosave;
export function chooseInitialLoad(location: { search: string; hash: string }, storage: StorageLike): InitialLoad;
```

- `StorageLike = Pick<Storage, 'getItem' | 'setItem'>`, wrapped so a throwing `setItem` (quota, privacy mode) is
  swallowed. `src/main.ts` passes the same guarded wrapper it already builds for the Gemini key.
- `save` is the debounced path (500 ms trailing, `setTimeout`); `saveNow` flushes any pending timer and writes
  synchronously; `flush` writes a pending value now (used before the page hides, open question 6 — default: also
  bind `visibilitychange`/`pagehide` to `flush`). Autosave is driven only by person actions (Edit-mode commits, the
  message box, typing in an unlocked Browse field, and loads from New Stack / fixture / Summon / import); a
  button-script dispatch does not call `save`, so a reloaded quiz starts fresh.
- `chooseInitialLoad` reads `#` first: a `s=` param (via `URLSearchParams(hash.slice(1))`) → `share`; else `?stack=`
  via the existing `fixtureFromSearch` when it names a real fixture → `fixture`; else a readable, valid autosave →
  `autosave`; else `default`. It does **not** decode the share fragment (async) — it returns the raw `encoded` for
  `main.ts` to decode. A corrupt autosave returns neither `autosave` nor an error; it returns `default` and sets a
  flag the caller reads via a second return (`corruptAutosave: boolean`) so the status message can be shown.

The autosave stores the canonical string; on read it runs `validateStack` so a hand-edited or stale value can never
load an invalid stack.

## File export/import

```ts
export class ShareImportError extends Error {}
export interface ExportDeps { createUrl?: (b: Blob) => string; revokeUrl?: (u: string) => void; anchor?: () => HTMLAnchorElement; document?: Document }
export function exportStack(stack: Stack, deps?: ExportDeps): void;
export function readStackFile(file: Blob): Promise<Stack>;
export function pickStackFile(doc?: Document): Promise<File | null>;
export function safeFileName(name: string): string;      // "The Haunted Quiz" -> "The Haunted Quiz.necrocard.json"
```

- `safeFileName` replaces characters outside `[A-Za-z0-9 _-]` with `-`, collapses runs, trims, and falls back to
  `stack`; then appends `.necrocard.json`.
- `exportStack` default deps use `document.createElement('a')`, `URL.createObjectURL`, `URL.revokeObjectURL`; the
  anchor is clicked and the URL revoked on the next tick. Tests pass a fake anchor to capture `download` and `href`.
- `readStackFile` uses `file.text()` (available on `Blob` in happy-dom and browsers).

## Share dialog

Reuses `createDialogShell('share-panel', 'Share this stack', onEscape)`. Contents:
- a read-only `<input>` (`.share-url`) — selected on focus;
- a row with Copy, Export, Import;
- a `.share-length` line (`123 characters`);
- a `.share-warning` paragraph, hidden unless `length > SHARE_URL_WARN` (`8000`).

```ts
export interface ShareDialogDeps {
  currentStack: () => Stack;                   // the live working copy
  onImported: (stack: Stack) => Promise<void>; // load in Edit mode with the picker entry
  encode?: typeof encodeStack;                 // injectable
  clipboard?: { writeText(t: string): Promise<void> };
  export?: (stack: Stack) => void;
  pickFile?: () => Promise<File | null>;
  read?: (file: Blob) => Promise<Stack>;
  status?: StatusLine;
}
```

`open()` builds `location.origin + location.pathname + '#' + FRAGMENT_PARAM + '=' + await encode(currentStack())`.
During the await the input reads `Building link…` and Copy is disabled. Copy: try `clipboard.writeText`; on reject
or absence, select the input and try `document.execCommand('copy')`; if that also fails, leave it selected and show
`Press Ctrl+C to copy.`. Import: `pickFile()` → `read()` → `onImported()`; a `ShareImportError` shows its message in
the dialog, not the status line, so the dialog stays open on a bad file.

## main.ts wiring

```ts
const storage = guardedStorage();                 // the existing try/catch wrapper, generalised
const autosave = createAutosave(storage);
const editor = new EditController({ /* … */ onChange: () => autosave.save(runtime.currentStack!) });

async function loadStack(stack, { autosave: save = true } = {}) { /* existing, then */ if (save) autosave.saveNow(stack); }

// message box path and unlocked-field typing in Browse call autosave.save(runtime.currentStack!) after a
// successful run; button-script dispatches do not.

const initial = chooseInitialLoad(location, storage);
switch (initial.source) {
  case 'share':    void openShared(initial.encoded); break;   // decode, load Browse with autosave OFF, showCustom, clear #
  case 'fixture':  void loadKey(initial.key); break;
  case 'autosave': void loadImported(initial.stack, 'browse'); break;  // keeps picker on custom, no fixture select
  case 'default':  void loadKey(DEFAULT_FIXTURE); break;
}
```

`currentStack` on the runtime returns `this.state?.stack ?? null` (the live working copy). `onChange` fires after a
committed edit; autosave debounces, so a drag that emits many commits writes once. A corrupt autosave reported by
`chooseInitialLoad` shows the REQ-2.3 status line and loads the default.

`openShared` loads with `{ autosave: false }`, so the shared stack is not persisted. `localStorage` keeps the
visitor's own last autosave; the next person-made edit (which goes through `onChange` / the message box) is what
first writes the shared stack, by design. A share link therefore never clobbers a saved stack on open, and a reload
right after opening a link restores the visitor's own stack.

The Share button sits in the toolbar after Settings; it is disabled with the others while busy.

## Testing

| File | Env | Covers |
|---|---|---|
| `src/share/codec.test.ts` | node | round-trip PBT; base64url-only output; a stack with a 512×342 1-bit image data URL round-trips (chunked btoa); tamper/truncate/empty/garbage → `ShareDecodeError` (no unhandled rejection); non-stack JSON → schema message |
| `src/share/autosave.test.ts` | happy-dom | debounce coalescing; `saveNow` flush; `chooseInitialLoad` priority; corrupt/unavailable storage |
| `src/share/file.test.ts` | happy-dom | `safeFileName`; export anchor name + blob decodes; `readStackFile` ok/errors; `pickStackFile` |
| `src/ui/share/shareDialog.test.ts` | happy-dom | URL has `#s=` and no query; length; warning threshold; Copy + fallback; Export/Import deps; import error stays in dialog |
| `src/share/boundary.test.ts` | node | every `src/share/` file imports only `src/model/` |
| `test/e2e/sharing.spec.ts` | Playwright | REQ-6.2 |

The fixture-shaped stack generator from `summon/pipeline.test.ts` is copied into a shared `src/share/testStacks.ts`
(test-only helper) rather than imported across spec folders, to keep the module boundary clean. (Open question 8:
keep it duplicated, small, or extract a shared `test/` helper — default: a small local generator seeded from the
three fixtures, no cross-spec import.)

---

## Open questions (defaults chosen; confirm or override)

1. **localStorage key.** `necrocard.autosave`. One key, one stack; namespaced like `necrocard.geminiKey`.
2. **Fragment parameter.** `#s=<encoded>` (`s` for "stack"). Short, and `URLSearchParams` parses the fragment body
   cleanly. Alternative `#stack=` is longer for no gain.
3. **Export filename.** `<name>.necrocard.json` with non-`[A-Za-z0-9 _-]` characters replaced by `-`, empty →
   `stack`. Keeps the double extension the import filter and the brief use.
4. **Length warning threshold.** 8000 characters. Comfortably under the ~32 KB some chat apps keep but past the ~2 KB
   point where old proxies truncate; a round number, not a guarantee. Export is always offered as the safe path.
5. **Compression format.** `deflate-raw`. Shortest (no header), symmetric, and native in Node 22 and browsers. Not
   `gzip` (18 extra bytes) or `deflate` (6).
6. **Flush on unload.** Bind `flush` to `pagehide` and `visibilitychange: hidden` so a fast close after an edit is
   not lost inside the 500 ms debounce. Default: yes.
7. **No polyfill.** If `CompressionStream` is missing (very old browsers), encode throws and the Share dialog shows
   the error; Export still works (it is plain JSON). Default: no polyfill, since the targets support it.
8. **Test stack generator.** A small local generator in `src/share/testStacks.ts` seeded from the three fixtures,
   not imported from the summon spec's tests. Default: local copy.
9. **Autosave on every browse mutation.** Confirmed: autosave captures only what the person did — Edit-mode
   commits, the message box, and typing into an unlocked field in Browse — plus loads. A button-script dispatch
   does not autosave, so a reloaded quiz starts fresh rather than resuming mid-play.
10. **Share URL path.** `origin + pathname`, dropping any existing query (so a link opened from `?stack=quiz` does
    not carry the fixile query). The fragment is the whole payload. Default: drop the query.
