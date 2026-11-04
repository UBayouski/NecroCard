# necrotalk-play — Design

## 1. Overview

`play` follows the `beep` seam end to end. `beep` is a keyword → a `BeepStatement` → `hostCall(line, () =>
host.beep())` in the evaluator → `webAudioBeep()` in `domHost` on the one shared `AudioContext`. `play` adds the
same chain plus a pure notes parser that turns the notes string into frequencies and beat lengths, and a scheduler
in `domHost` that plays them in sequence.

Five seams, all existing:

1. **Tokenizer** gains `play`, `tempo`, `stop` as keywords (so they are reserved words, and the script editor's
   highlighter — which tokenizes with the same module — colours them for free).
2. **AST + parser** gain a `PlayStatement` and a printer case, parsed next to `beep` in the statement dispatch.
3. **Notes module** (`src/interp/notes.ts`, pure) parses a notes string to `Note[]` and formats it back.
4. **Evaluator** resolves the notes and tempo expressions, parses the notes, and calls `host.play` / `host.stopSound`
   through the existing `hostCall` host-error wrapper.
5. **domHost** implements `play`/`stopSound` by scheduling square-wave oscillators on the shared context; `main.ts`
   calls `stopSound` on stack load and on entering Edit.

This satisfies REQ-1–REQ-9. It touches no new area: the architecture already anticipated `play` (the interpreter
spec kept it out of scope but non-blocking).

### Module map

| File | Change |
|---|---|
| `src/interp/tokenizer.ts` | add `play`, `tempo`, `stop` to `KEYWORDS` |
| `src/interp/ast.ts` | add `PlayStatement` |
| `src/interp/parser.ts` | parse `play stop` / `play [tempo <expr>] <expr>`; print it |
| `src/interp/notes.ts` | **new** — pure `parseNotes` / `formatNotes`, `Note` type, `NoteParseError` |
| `src/interp/evaluator.ts` | `HostInterface.play`/`stopSound`; execute `PlayStatement` |
| `src/ui/browse/domHost.ts` | implement `play`/`stopSound`; a `Voice` scheduler on the shared context |
| `src/ui/browse/runtime.ts` | expose a `stopSound()` pass-through (so `main.ts` need not reach the host) |
| `src/main.ts` | call `stopSound` on `loadStack` and on entering Edit (REQ-3.3) |
| `src/summon/grammar.ts`, `prompts.ts` | move `play` to supported; one short rule; one example |
| `fixtures/*.necrocard.json` | the sound lines of REQ-7 |

No change to `src/model/`, `server/`, `src/share/`, `src/ui/edit/`, or deps. The script-editor highlighter needs no
edit (it reads `interp/tokenizer`). `eval` stays absent from `src/interp/`.

---

## 2. Notes module (`src/interp/notes.ts`, pure) — REQ-2

### 2.1 Types

```ts
export interface Note {
  /** Hz, or null for a rest. */
  frequency: number | null;
  /** Length in quarter-note beats: w=4, h=2, q=1, e=0.5, s=0.25. */
  beats: number;
}

export class NoteParseError extends Error {
  constructor(readonly token: string) { super(`"${token}" is not a note`); }
}

export function parseNotes(source: string): Note[];   // throws NoteParseError
export function formatNotes(notes: Note[]): string;    // canonical notes string
```

`NoteParseError` carries the offending token but **no line number** — it is not a `NecroTalkError` (the notes
module has no line context, per REQ-2.2). The evaluator catches it and rethrows as a `NecroTalkError` at the `play`
line (§4).

### 2.2 Parsing (REQ-2.1)

`parseNotes` splits on whitespace and folds a running `(octave, duration)` state, both sticky:

```
state = { octave: 4, durBeats: 1 }   // default octave 4, default quarter
for each token (lowercased):
  match /^([a-gr])(#|b)?([0-8])?([whqes])?$/
    no match                → throw NoteParseError(originalToken)
    letter 'r'              → rest; if accidental or octave present → NoteParseError
    duration given          → state.durBeats = { w:4, h:2, q:1, e:0.5, s:0.25 }[d]
    octave given (non-rest) → state.octave = digit
    frequency = letter==='r' ? null : freqOf(letter, accidental, state.octave)
    push { frequency, beats: state.durBeats }
```

- An empty or all-whitespace string → `[]` (valid, plays nothing, REQ-2.2 crit 3).
- Case-insensitive on the letter and duration; the accidental is literally `#` or `b` (REQ-2.1 crit 5). Note that
  `b` is both the note B and the flat accidental — the regex binds the first char as the letter, so `bb` is B-flat,
  `b` is B natural, `cb` is C-flat; this matches HyperCard and the regex resolves it unambiguously.

`freqOf(letter, accidental, octave)`:

```
SEMITONE = { c:-9, d:-7, e:-5, f:-4, g:-2, a:0, b:2 }   // semitones from A within the octave
n = SEMITONE[letter] + (accidental==='#' ? 1 : accidental==='b' ? -1 : 0) + 12 * (octave - 4)
frequency = 440 * 2 ** (n / 12)
```

So `a4` = 440, `a5` = 880, `c4` ≈ 261.63. Every non-rest frequency is `440 × 2^(n/12)` for an integer `n`
(REQ-6.2 pitch property).

### 2.3 Formatting (REQ-2.3)

`formatNotes` emits each note as `letter[accidental][octave][duration]`, writing the octave and duration only when
they change from the running state (so the round-trip is canonical and stable). The reverse of the stick rule:
start from octave 4 / quarter, emit an octave digit when the note's octave differs from the running octave, a
duration letter when it differs from the running duration. A rest is `r` with a duration letter when it changes.
`parseNotes(formatNotes(x))` deep-equals `x` for any `Note[]` built from the generator (REQ-6.2 round-trip).

> Round-trip note: the generator for the property produces `Note`s whose frequency is a valid semitone pitch (or
> null) and whose `beats` is one of the five durations, so every generated list is representable; the property is
> over *representable* note lists, which is what `formatNotes` must round-trip.

---

## 3. Grammar: tokenizer, AST, parser, printer — REQ-1

### 3.1 Tokenizer (REQ-1.2)

Add `'play', 'tempo', 'stop'` to `KEYWORDS`. They become reserved words automatically (the parser's `expectName`
rejects keywords), and the highlighter colours them as keywords with no change. The notes string is an ordinary
string token; the tokenizer never looks inside it.

### 3.2 AST (REQ-1.3)

```ts
export interface PlayStatement {
  kind: 'play';
  line: number;
  /** 'stop' silences; 'notes' plays the melody. */
  action: 'stop' | 'notes';
  notes?: ExpressionNode;   // present when action==='notes'
  tempo?: ExpressionNode;   // optional; present only with a tempo prefix
}
```

Added to the `StatementNode` union. Type-only, per `necrotalk.md`.

### 3.3 Parser (REQ-1.1)

In the statement dispatch, next to `case 'beep'`:

```
case 'play':
  advance()
  if matchKeyword('stop'): expectNewlineOrEof(); return { kind:'play', action:'stop', line }
  let tempo
  if matchKeyword('tempo'): tempo = parseExpression()   // a number expression
  notes = parseExpression()                              // required; its absence is the parse error
  expectNewlineOrEof()
  return { kind:'play', action:'notes', notes, tempo, line }
```

- `play` with nothing (newline/eof) → `parseExpression` fails with the standard "Expected expression but found end
  of line/script" error at the line (REQ-1.1 crit 5).
- `play tempo 160` with no notes → after the tempo expression, `parseExpression` for notes hits end of line and
  fails the same way (REQ, OQ6): `tempo` is only a prefix.
- The notes and tempo operands are full expressions, evaluated at run time (REQ-1.1 crit 4).

### 3.4 Printer (REQ-1.3)

In the printer's `switch (stmt.kind)`:

```
case 'play':
  if stmt.action === 'stop' return [`${i}play stop`]
  const t = stmt.tempo ? `tempo ${printExpr(stmt.tempo)} ` : ''
  return [`${i}play ${t}${printExpr(stmt.notes)}`]
```

`play stop`, `play "c e g"`, `play tempo 160 "c e g"` and `play theTune` all print back to source that re-parses to
an identical AST (folded into the existing parse → print → parse PBT, REQ-6.1 crit 3).

---

## 4. Evaluation — REQ-3

### 4.1 Host interface (REQ-3.1)

```ts
// Feedback — synchronous (next to beep)
beep(): void;
play(notes: Note[], tempo: number): void;
stopSound(): void;
```

`Note` is imported from `notes.ts` into `evaluator.ts` (the evaluator may import the pure notes module; it still
does not import the tokenizer or parser). `domHost`, the mock hosts in the interpreter tests, and any other
`HostInterface` implementer gain the two methods.

### 4.2 Executing `PlayStatement` (REQ-3.2, REQ-3.4)

```
case 'play': {
  if (stmt.action === 'stop') { hostCall(line, () => host.stopSound()); return; }
  const tempo = stmt.tempo ? Number(evaluateExpression(stmt.tempo, scope, line)) : 120;
  if (!(tempo > 0) || !Number.isFinite(tempo)) throw new NecroTalkError(formatError(line, 1, `${...} is not a valid tempo`), line, 1);
  const source = evaluateExpression(stmt.notes, scope, line);
  let notes: Note[];
  try { notes = parseNotes(source); }
  catch (e) {
    if (e instanceof NoteParseError) throw new NecroTalkError(formatError(line, 1, `"${e.token}" is not a note`), line, 1);
    throw e;
  }
  hostCall(line, () => host.play(notes, tempo));
  return;
}
```

- The bad-token and bad-tempo errors are raised **before** any `host.play` call, so a bad melody plays nothing
  (REQ-3.4 crit 3). The messages carry the offending token / value and the line, in the steering format.
- `host.play` is wrapped by `hostCall`, so an audio exception becomes a `NecroTalkError` at the line — but the host
  is written to swallow ordinary audio-unavailable conditions (§5), so that path is only for genuine faults.
- `play` returns as soon as `host.play` is called; the evaluator never awaits the melody (REQ-3.2 crit 1).
  Replace-in-progress (crit 2) is the host's behaviour: a second `host.play` cancels the first (§5.2).

---

## 5. The voice (`src/ui/browse/domHost.ts`) — REQ-4

### 5.1 A single voice on the shared context

`domHost` keeps the module-level `audio` context `webAudioBeep` uses, and tracks the voices scheduled by the
current `play`. A voice is silenced through its **gain**, never by a second `osc.stop()` (Web Audio throws on a
second stop, and a stop inside the same `try` as the disconnect would be skipped, leaving a future note to sound at
its scheduled time):

```ts
const GAP = 0.01;            // 10 ms silence between notes (REQ-4.1, resolved decision 3)
const ATTACK = 0.005, RELEASE = 0.01;
interface Voice { osc: OscillatorNode; gain: GainNode }
let scheduled: Voice[] = [];

function playNotes(notes: Note[], tempo: number): void {
  const ctx = ensureAudio(); if (!ctx) return;        // no context yet (pre-gesture) / unavailable → silent
  stopSound();                                        // replace any melody in progress
  let t = ctx.currentTime;
  for (const note of notes) {
    const dur = note.beats * 60 / tempo;              // seconds
    if (note.frequency !== null) {
      const sound = Math.max(dur / 2, dur - GAP);     // leave a 10 ms gap, but never below half (decision 3)
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'square'; osc.frequency.value = note.frequency;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.1, t + ATTACK);            // the beep's 0.1 volume
      gain.gain.setValueAtTime(0.1, t + Math.max(ATTACK, sound - RELEASE));
      gain.gain.linearRampToValueAtTime(0, t + sound);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + sound);
      const voice: Voice = { osc, gain };
      scheduled.push(voice);
      osc.onended = () => {                            // drop finished voices so the list cannot grow unbounded
        const i = scheduled.indexOf(voice);
        if (i >= 0) scheduled.splice(i, 1);
      };
    }
    t += dur;                                         // a rest advances the offset only
  }
}

function stopSound(): void {
  const ctx = audio;
  for (const { osc, gain } of scheduled) {
    try {
      if (ctx) { gain.gain.cancelScheduledValues(ctx.currentTime); gain.gain.setValueAtTime(0, ctx.currentTime); }
      gain.disconnect();                               // silence through the gain, before touching the oscillator
    } catch { /* already torn down */ }
    try { osc.stop(); } catch { /* already stopped (its scheduled stop ran) */ }
  }
  scheduled = [];
}
```

`DomHost.play(notes, tempo)` calls `playNotes`; `DomHost.stopSound()` calls `stopSound`. Both swallow failures, like
`webAudioBeep` (REQ-4.2 crit 3). Start times are spaced by `beats × 60 / tempo`, so the domHost test can assert the
schedule from the tempo (REQ-6.4 crit 2).

### 5.2 Replace and stop (REQ-3.2, REQ-4.1)

`playNotes` calls `stopSound()` first, so a new `play` cancels the previous melody before scheduling its own.
`stopSound()` silences **every scheduled voice through its gain**: it cancels the gain's scheduled values at
`ctx.currentTime` and sets the gain to 0, then disconnects the gain, so a note scheduled in the future is silenced
even though its oscillator has not started. Only after that does it `try osc.stop()` in its own `try` — a second
`stop()` on an oscillator whose scheduled stop already ran throws, and that throw is caught and does not skip the
gain work (which already happened). An `onended` handler removes each finished voice from `scheduled`, so the list
does not grow for the life of the page.

### 5.3 Gesture gating (REQ-4.2)

The shared `AudioContext` is created **only inside the one-time gesture listener**, not lazily on the first
`play`. Creating a context before any user gesture makes Chrome log a "The AudioContext was not allowed to start"
warning, which would show up in the MCP console read; deferring creation to the first `pointerdown`/`keydown`
avoids it. `ensureAudio()` therefore returns the context if it exists and `null` before the first gesture — a
melody (or beep) fired pre-gesture is silently dropped. In practice both `beep` and `play` run after a click, so
nothing audible is lost. The one-time listener (registered in the browse layer — `domHost` or the runtime — not
`main.ts`) creates the context, calls `audio.resume()` (swallowing a rejected resume), and removes itself.

This also means `webAudioBeep` uses the same `ensureAudio()` gate, so beep and play share the one gesture-created
context. Before the first gesture, `audio` is null and both are silent.

> Consequence for the fixtures: the Cursed Manor `Entrance` title theme plays when the stack is chosen from the
> picker or navigated to (both follow a click), and is silent on a cold reload — expected, not a bug. The quiz e2e
> clicks an answer (a gesture) before asserting sound (REQ-8.1).

### 5.4 Lifecycle stop (REQ-3.3)

`BrowseRuntime` exposes `stopSound()` that forwards to its current host (null-safe). `src/main.ts` calls it:

- in `loadStack`, before/at the load, so a melody never crosses a stack change;
- when entering Edit (`editor.enter` path / the mode toggle), so leaving Browse silences sound.

These are the two places the mode toggle and `loadStack` already live (REQ-3.3 crit 2); no new module.

---

## 6. Summon — REQ-5

### 6.1 grammar.ts

- Add to the commands list, near `beep`:
  `play "<notes>" | play tempo <n> "<notes>" | play stop` with a one-line notes grammar: letters a–g, optional #/b,
  optional octave 0–8 (default 4, sticks), optional duration w/h/q/e/s (default q, sticks), r for a rest; A4 = 440.
- Remove `play` from the "Not supported (never use)" line; keep `item`, `find`, `send` there.
- Add one short `GRAMMAR_EXAMPLES` entry (or a `play` line in an existing one) — e.g. a mouseUp that plays a
  three-note sting — kept under a handful of notes. `prompts.test.ts` parses every example with the real parser, so
  the example must parse (and its notes must parse under `parseNotes`; the test can assert that too).

### 6.2 prompts.ts

One sentence in the system instruction: `play` is optional; melodies stay short (under 16 notes). Nothing else
grows. `prompts.test.ts` stays green (schema text unchanged; the grammar summary still contains every example).

---

## 7. Fixtures — REQ-7

Script-text-only edits (plus two minimal `openCard` handlers on the Manor). Each melody is short and parses under
`parseNotes`.

- **Quiz:** each answer button's `mouseUp` gets a `play` before its `go`. A right answer → a rising fanfare
  (e.g. `play "c e g c5"`); a wrong answer → a falling pair (e.g. `play "e c"`). The buttons already differ by
  destination, so right vs wrong is just which line goes where.
- **Cursed Manor:** add `on openCard` to `Entrance` (title theme, e.g. `play "c e g e c"`) and to `Cellar` (a
  four-note sting, e.g. `play "a2 g2 e2 c2"`). These are the only two `openCard` handlers; no object changes.
- **Flashcards:** the Flip button's `mouseUp` gets one short click (`play "c5s"`) alongside `show field "Answer"`.

A fixtures test (REQ-7.4) parses every script in all three fixtures with the real parser and runs `parseNotes` on
every `play` string; the schema validation and the model/interp PBT suites are unchanged and stay green.

---

## 8. Testing — REQ-6, REQ-8

### 8.1 Interpreter unit (Vitest)

- `tokenizer.test.ts`: `play`/`tempo`/`stop` are keyword tokens; a notes string is a string token.
- `parser.test.ts`: the four parse forms and the two parse errors (`play` alone, `play tempo 160` alone).
- `ast.test.ts` / printer: `PlayStatement` narrows on `kind`; the three printed forms re-parse identically (the
  existing parse → print → parse PBT covers it once `play` is in the generator, or an explicit example if the
  generator does not emit `play`).

### 8.2 Notes parser (Vitest + fast-check ≥ 200 runs)

- Units: default octave 4 / duration q; octave and duration stick; `#`/`b`; rests; case insensitivity; `a4` = 440;
  empty string → `[]`; a bad token throws `NoteParseError` naming the token.
- Property round-trip: `parseNotes(formatNotes(notes))` deep-equals `notes` for any generated representable list.
- Property pitch: every non-rest frequency has `Math.log2(f / 440) * 12` an integer within tolerance; rests are
  null.

### 8.3 Evaluator (Vitest, recording host)

A `HostInterface` recording `play`/`stopSound`: `play "c e g"` → one `play(3 notes, 120)`; `play tempo 160 "c"` →
tempo 160; two `play`s → two calls; `play stop` → `stopSound()`; `play "h9"` → `NecroTalkError` at the line naming
`h9`, no `play` call.

### 8.4 domHost (Vitest, fake AudioContext)

A fake `AudioContext` recording oscillators, `frequency`, `start`/`stop` times, and per-gain
`cancelScheduledValues`/`setValueAtTime`/`disconnect` calls, with a controllable `currentTime`:

1. A known melody schedules the expected frequencies with start times spaced from the tempo (asserted as relative
   offsets, not absolute times).
2. `stopSound()` and a replacing `play` cancel and disconnect the scheduled voices.
3. **Stop before a future note starts (the §5.2 correction):** schedule three notes, advance `currentTime` so the
   first has started but the second has not, call `stopSound()`, and assert the second and third voices' gains were
   cancelled (`cancelScheduledValues`) and disconnected — so a not-yet-started note is silenced, not left to sound.
4. The gesture gate: before the one-time gesture, `ensureAudio()` returns null and `play`/`beep` are no-ops that do
   not throw and create no context; after a simulated `pointerdown`/`keydown` the context exists and `play`
   schedules.

### 8.5 Fixtures (Vitest)

The existing fixture tests stay green; add (or extend) a test that every `play` string in the fixtures parses under
`parseNotes`.

### 8.6 e2e (`test/e2e/play.spec.ts`, REQ-8.1)

`addInitScript` stubs `AudioContext` before load, recording created oscillators and frequencies. Open the quiz,
click an answer (the gesture), assert the stub saw ≥ 1 oscillator with positive frequencies and that there is no
`role="alert"` text and no console error.

### 8.7 MCP (REQ-8.2)

One dev-server run: open the quiz, click through to a right answer, read the console (only the expected
`/api/health` 502). No screenshot; confirm the melody scheduled via a short `browser_evaluate` on the stubbed or
real context, and clear `localStorage` if a sample fork left a library copy.

---

## 9. Risks and notes

1. **`b` as note vs flat** (§2.2): the regex binds the first character as the note letter, so `b`=B, `bb`=B-flat,
   `cb`=C-flat. Unambiguous, but worth a unit case so no one "fixes" it later.
2. **Host-interface breakage:** adding `play`/`stopSound` to `HostInterface` means every implementer must gain
   them — `domHost` and the interpreter test mock hosts. `tsc` will flag any missed one; the mocks are updated with
   no-op/recording stubs. This is the one change that reaches existing interpreter test files.
3. **Fake-context time:** the fake `AudioContext` needs a `currentTime` that advances (or stays 0 and the test
   asserts relative `start` offsets). The test controls it, so start-time spacing is asserted as differences, not
   absolute values.
4. **No model/edit/share/server change:** `play` is interpreter + browse-host + summon + fixtures only, so those
   boundaries and their guards stay green.
5. **Deferred context changes `beep` timing slightly:** moving context creation into the gesture listener means
   `beep` is also silent until the first gesture (it was effectively so already, since a pre-gesture context is
   suspended). The change removes the Chrome "not allowed to start" warning from the console, which the MCP run
   reads. No `beep` behaviour a person can hear changes.
