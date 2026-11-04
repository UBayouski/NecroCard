# necrotalk-play — Requirements

## Overview

Add one synthesized voice to NecroTalk: `play "<notes>"` and `play stop`. Sample and summoned stacks can then play
short stings and jingles — a fanfare on a right answer, a four-note sting when a scary card opens, a title theme on
the first card. It is a 1-bit computer tone (a square wave at the beep's volume), not recorded sound, and there is
exactly one instrument and one voice.

This is spec 11 and the third NecroTalk phase-2 item (`docs/BRIEF.md` section 4 phase 2, item 3; steering
`necrotalk.md` phase 2, item 3). Scope is `play` and `play stop` only. The other phase-2 NecroTalk items — `item N`
chunks, `find`, `send` — stay unimplemented and stay on the unsupported list.

It builds on `necrotalk-interpreter` (the tokenizer, recursive-descent parser, AST printer, tree-walking evaluator
and `HostInterface`, whose `beep()` is the model for the new host calls), `browse-mode` (`src/ui/browse/domHost.ts`,
whose `webAudioBeep` is the model for the oscillator code and the single shared `AudioContext`), `script-editor`
(the editor's own tokenizer) and `summon` (the system instruction and `grammar.ts`).

Sources: `docs/BRIEF.md` section 4 (NecroTalk grammar, phase 2 item 3); steering `necrotalk.md` (grammar, module
structure, error style, phase-2 list) and `retro-ui.md` (the sound is a 1-bit tone, consistent with the beep);
`necrotalk-interpreter` REQ-1/REQ-4 (AST, host interface) and its error conventions.

### In scope

Tokenizer and parser support for `play <expr>`, `play stop` and an optional `tempo <number>` prefix; a pure notes
parser in `src/interp`; AST printer (formatter) support for `play`; two new `HostInterface` methods (`play`,
`stopSound`); `domHost.ts` scheduling oscillators from parsed notes with a shared, gesture-resumed `AudioContext`;
the script editor's tokenizer learning `play`/`tempo`/`stop`; the Summon system instruction and `grammar.ts`
learning `play`; sound added to the three sample fixtures in their existing handlers only; Vitest unit and property
tests; a `domHost` test with a fake `AudioContext`; a Playwright e2e that stubs `AudioContext`; one Playwright MCP
run.

### Out of scope

`item` chunks, `find`, `send` (still unsupported); more than one voice or instrument; chords; recorded or sampled
sound; volume, pan or envelope controls in the language; MIDI; `play` of a field or external file; any change to
`src/model/`, `server/`, `src/share/`, `src/ui/edit/`; new dependencies; any fixture change beyond the sound lines
of REQ-7.

---

## REQ-1 — Grammar: `play` and `play stop`

### REQ-1.1 — Statement forms

```
play stop
play [tempo <number>] <expr>
```

`<expr>` is any expression that evaluates to a string (a string literal, a variable, a concatenation), so
`play "c e g"` and `play theTune` both parse. `tempo <number>` is an optional prefix; `<number>` is an expression
evaluating to a positive number, the beats per minute (a quarter note is one beat), default 120.

Acceptance criteria:
1. `play stop` parses to a distinct statement (no notes, no tempo).
2. `play <expr>` parses with the notes expression and no tempo (tempo defaults to 120 at evaluation).
3. `play tempo <expr> <expr>` parses with a tempo expression and a notes expression.
4. The notes operand and the tempo operand are full expressions, evaluated at run time (REQ-3), not parse-time
   string literals.
5. `play` with nothing after it, or `play tempo` with no number, is a parse error with the line and the offending
   token, in the steering error format.

### REQ-1.2 — Tokenizer

Acceptance criteria:
1. `play`, `tempo` and `stop` are added to the tokenizer `KEYWORDS` (lowercase), so they are reserved words and
   cannot be variable or handler names (the existing reserved-word rule, `necrotalk.md`).
2. The notes string itself is an ordinary double-quoted string token or any expression; the tokenizer does not
   parse note letters — that is the evaluator's job via the notes module (REQ-2).
3. The `script-editor` tokenizer (the editor's highlighter) learns `play`, `tempo` and `stop` as keywords so they
   highlight like other commands.

### REQ-1.3 — AST and printer

Acceptance criteria:
1. `ast.ts` gains a `PlayStatement` with `kind: 'play'`, a discriminated shape distinguishing stop from a melody,
   the notes expression node, and an optional tempo expression node. Type declarations only (no logic), per
   `necrotalk.md`.
2. The AST printer formats `play stop`, `play <expr>` and `play tempo <expr> <expr>` back to source that
   re-parses to an identical AST (the parse → print → parse round-trip PBT target in `necrotalk.md`).
3. The printer places `tempo` before the notes expression and omits it when absent.

---

## REQ-2 — Notes parser (`src/interp`, pure)

A pure module (for example `src/interp/notes.ts`) parses a notes string into a list of notes with frequencies and
durations. It has no host or DOM dependency, so it is unit-testable and shared by the evaluator and `domHost`.

### REQ-2.1 — Notes string grammar

A notes string is whitespace-separated tokens. Each token is one of:
- a note: a letter `a`–`g`, an optional accidental `#` or `b`, an optional octave digit `0`–`8`, an optional
  duration letter `w h q e s`; or
- a rest: `r`, with an optional duration letter.

Acceptance criteria:
1. The octave digit, once given on a note, becomes the default octave for later notes (as in HyperCard); the
   starting default is 4.
2. The duration letter, once given, becomes the default duration for later notes and rests; the starting default
   is `q` (quarter). `w h q e s` are whole, half, quarter, eighth, sixteenth.
3. `A4` is 440 Hz; pitch is equal temperament, so every note's frequency is `440 × 2^(semitones / 12)` for an
   integer `semitones` offset from A4. `#` raises and `b` lowers by one semitone.
4. A rest has a duration but no frequency.
5. Parsing is case-insensitive for the note letter and duration letter (`C E G` and `c e g` are equal); the
   accidental is `#` or `b`.
6. Token order is preserved; the parser returns a list of `{ frequency: number | null; beats: number }` (or
   equivalent), where `beats` is the note's length in quarter-note beats (`w`=4, `h`=2, `q`=1, `e`=0.5, `s`=0.25).

### REQ-2.2 — Parse errors

Acceptance criteria:
1. A token that is not a valid note or rest makes the parse fail with a message naming the offending token, so the
   evaluator can raise a runtime error at the `play` line (REQ-3.4).
2. The failure is reported as a value the evaluator turns into a `NecroTalkError` (a thrown typed error or a result
   the evaluator checks) — the notes module itself does not construct `NecroTalkError` (it has no line number).
3. An empty notes string (or all whitespace) is valid and plays nothing (it is not an error).

### REQ-2.3 — Formatter

Acceptance criteria:
1. The notes module can format a note list back to a canonical notes string (used by the round-trip property,
   REQ-6.2).
2. The canonical form is stable: formatting a list and parsing it back yields an equal list.

---

## REQ-3 — Evaluation (`evaluator.ts`, `HostInterface`)

### REQ-3.1 — Host interface

Acceptance criteria:
1. `HostInterface` gains `play(notes, tempo)` and `stopSound()`, both synchronous like `beep()`, where `notes` is
   the parsed note list (REQ-2) and `tempo` is the resolved beats per minute.
2. The evaluator parses the notes string with the notes module, resolves the tempo expression (default 120), and
   calls `host.play(...)`; `play stop` calls `host.stopSound()`.
3. Every host call goes through the evaluator's host-error conversion (`necrotalk.md`), so a host audio failure
   becomes a `NecroTalkError` at the statement line; the host's own methods never throw for ordinary
   audio-unavailable conditions (they are silent, like `beep`).

### REQ-3.2 — Non-blocking

Acceptance criteria:
1. `play` returns immediately; the handler continues running while the melody plays (it does not await the
   melody's duration).
2. A subsequent `play` while a melody is in progress replaces it: the host stops the current oscillators and starts
   the new ones.

### REQ-3.3 — Stop and lifecycle

Acceptance criteria:
1. `play stop` silences the voice at once; with nothing playing it is a silent no-op (never an error).
2. The runtime stops any sound on a stack load and on entering Edit mode (leaving Browse), so a melody never
   outlives the card that started it. This is wired where the mode toggle and `loadStack` live — `src/main.ts` —
   calling the host's `stopSound()`; it is not a language feature.

### REQ-3.4 — Bad token is a runtime error

Acceptance criteria:
1. A notes string with an unparseable token raises a `NecroTalkError` at the `play` statement's line, with the
   offending token in the message, in the steering format (for example `Line 3: "h9" is not a note`).
2. A non-positive or non-numeric tempo is a runtime error at the `play` line, in the same format.
3. The error is raised before any sound starts, so a bad melody plays nothing.

---

## REQ-4 — The voice (`src/ui/browse/domHost.ts`)

### REQ-4.1 — Scheduling

Acceptance criteria:
1. `domHost` schedules one oscillator per non-rest note on the shared `AudioContext` (the same single context
   `webAudioBeep` uses), in sequence: each note starts at the running offset `start` and lasts `beats × 60 / tempo`
   seconds; a rest advances the offset without an oscillator.
2. The voice is a square wave at the beep's volume (gain ~0.1), with a short attack and release ramp so notes do
   not click, and a fixed 10 ms gap between consecutive notes so repeated notes stay distinct. The 10 ms is
   subtracted from each note's sounding length, but the sounding length never drops below half the note's full
   length (so very short notes still sound).
3. `play` cancels any oscillators still scheduled from a previous `play` before scheduling the new melody
   (replace-in-progress, REQ-3.2).
4. `stopSound()` cancels and silences all scheduled oscillators at once.

### REQ-4.2 — Gesture gating

Acceptance criteria:
1. Browsers block audio until the first user gesture. A melody started before any gesture is dropped silently (no
   error, no sound), exactly as a blocked `beep` is.
2. The host resumes the shared `AudioContext` on the first pointer or key event (a one-time resume), so sound works
   after the first click, as `beep` effectively does today.
3. Audio-unavailable conditions (no `AudioContext`, a rejected `resume`) are swallowed; `play` is feedback only.
4. Because `openCard` runs before any gesture on a fresh page load, an `openCard` melody is heard only when the
   stack is chosen from the picker or reached by navigation (both follow a click), and is silent on a cold reload.
   This is expected, not a bug. The Cursed Manor's `Entrance` title theme (REQ-7.2) therefore plays on choosing or
   navigating to it, not on a cold reload, and the quiz e2e (REQ-8.1) must click before it expects sound.

---

## REQ-5 — Summon

### REQ-5.1 — Grammar reference and system instruction

Acceptance criteria:
1. `src/summon/grammar.ts` moves `play` out of the "Not supported (never use)" list and documents the two forms,
   the optional `tempo`, and the notes-string grammar briefly (note letters, accidentals, octave, durations,
   rests).
2. `item`, `find` and `send` stay on the unsupported list.
3. `src/summon/prompts.ts` (the system instruction) gains one short rule: `play` is optional, and melodies stay
   short (under 16 notes), so a summoned stack may add a sting without the prompt growing much.
4. `prompts.test.ts` still passes: every grammar example parses with the real parser, and any example that uses
   `play` parses and plays-parses cleanly.

### REQ-5.2 — Grammar example

Acceptance criteria:
1. `GRAMMAR_EXAMPLES` gains (or extends) one example showing `play "<notes>"` in a handler, kept short, so the
   model sees the shape; the example parses under the real parser (the existing `prompts.test.ts` guarantee).

---

## REQ-6 — Testing (interpreter)

### REQ-6.1 — Tokenizer and parser (Vitest)

Acceptance criteria:
1. Tokenizer: `play`, `tempo`, `stop` tokenize as keywords; a notes string tokenizes as a normal string.
2. Parser: `play stop`, `play "c e g"`, `play tempo 160 "c e g"`, and `play theTune` each parse to the right AST;
   `play` alone and `play tempo` alone are parse errors with the line and offending token.
3. Printer round-trip: each form prints back to source that re-parses to an identical AST (folded into the existing
   parse → print → parse PBT).

### REQ-6.2 — Notes parser (Vitest + fast-check, ≥ 200 runs)

Acceptance criteria:
1. Unit cases: default octave 4 and default duration `q`; octave and duration stick; `#`/`b`; rests; case
   insensitivity; `A4` = 440; an empty string parses to no notes; a bad token fails with the token named.
2. Property (round-trip): for any generated note sequence, `parse(format(notes))` equals `notes`.
3. Property (pitch): every parsed note's frequency is `440 × 2^(n/12)` for an integer `n` — i.e.
   `log2(freq / 440) × 12` is an integer (within floating-point tolerance), and a rest's frequency is null.

### REQ-6.3 — Evaluator (Vitest, recording host)

Acceptance criteria:
1. A recording `HostInterface` captures `play(notes, tempo)` and `stopSound()` calls.
2. `play "c e g"` calls `play` once with three notes and tempo 120; `play tempo 160 "c"` passes tempo 160.
3. A second `play` in the same handler produces a second `play` call (replace is the host's job; the evaluator just
   calls again).
4. `play stop` calls `stopSound()`.
5. A bad token (`play "h9"`) raises a `NecroTalkError` at the `play` line naming the token, and makes no `play`
   call.

### REQ-6.4 — domHost (Vitest, fake AudioContext)

Acceptance criteria:
1. A fake `AudioContext` records created oscillators, their `frequency` values, and their `start`/`stop` times.
2. `play` of a known melody schedules the expected frequencies, with start times spaced by `beats × 60 / tempo`
   from the tempo (a higher tempo packs them closer).
3. `stopSound()` (and a replacing `play`) cancels the scheduled oscillators.
4. With no `AudioContext` available, `play` is a no-op and does not throw (gesture/availability gating, REQ-4.2).

---

## REQ-7 — Sample stacks (fixtures)

Sound is added only inside the samples' existing handlers; no object, card, rect, name or script-structure change
otherwise. The fixture validation and the interpreter/model PBT suites stay green.

### REQ-7.1 — The Haunted Quiz

Acceptance criteria:
1. A right-answer button plays a short rising fanfare; a wrong-answer button plays a falling pair. (The quiz's
   answer buttons already differ by which card they go to; the `play` line is added to each button's existing
   `mouseUp` before the `go`.)
2. The added melodies are short (a handful of notes) and parse under the notes module.

### REQ-7.2 — The Cursed Manor

Acceptance criteria:
1. None of the Manor's five cards has an `openCard` handler today, so this spec adds exactly two minimal
   `openCard` handlers (script-only, no object change): the first card `Entrance` plays a short title theme, and
   the scary card `Cellar` plays a short four-note sting.
2. Each added `openCard` contains only the `play` line; no other handler or object changes.

### REQ-7.3 — Spooky Flashcards

Acceptance criteria:
1. The Flip button's existing `mouseUp` plays one short click (a single very short note) in addition to showing the
   answer.

### REQ-7.4 — Fixtures stay valid

Acceptance criteria:
1. Every changed script still parses under the real parser; the fixture schema validation stays green; the model
   and interpreter PBT suites stay green.
2. No fixture gains or loses an object, card or property; only script text inside existing handlers changes, plus
   the two minimal `openCard` handlers added to the Manor's `Entrance` and `Cellar` cards (REQ-7.2).

---

## REQ-8 — End-to-end and MCP

### REQ-8.1 — Playwright e2e (`test/e2e/play.spec.ts`)

Acceptance criteria:
1. The test stubs `AudioContext` with `addInitScript` before load, recording created oscillators and their
   frequencies.
2. It opens the quiz, answers a question (clicks an answer button — the click is also the gesture that unblocks
   audio, REQ-4.2 criterion 4), and asserts the stub saw a melody (one or more oscillators scheduled) and that the
   page logged no script error (no `role="alert"` text, no console error).
3. A stub-level assertion confirms the frequencies look like notes (each a positive number), without asserting
   exact pitches (that is the unit test's job).

### REQ-8.2 — Playwright MCP

Acceptance criteria:
1. One run against the dev server plays the quiz once (open the quiz, click through to a right answer) and reads
   the console; the only expected error is the unrelated `/api/health` 502.
2. No screenshot is required (sound is not visible); the run notes that the melody was scheduled via the console or
   a short evaluate check, and leaves no persistent state it created (clear `localStorage` if the run forked a
   library copy).

---

## REQ-9 — Constraints

- Changes live in `src/interp/` (`tokenizer.ts`, `parser.ts`, `ast.ts`, `evaluator.ts`, the new notes module),
  `src/ui/browse/domHost.ts`, `src/main.ts` (stop sound on stack load and on entering Edit — where the mode toggle
  and `loadStack` live, REQ-3.3), the `script-editor` tokenizer, `src/summon/prompts.ts` and `grammar.ts`, and
  `fixtures/` as limited by REQ-7, plus tests.
- No change to `src/model/`, `server/`, `src/share/`, `src/ui/edit/`, or `package.json` dependencies.
- The evaluator must not import the tokenizer or parser at runtime (only `ast.ts`); the notes module is pure and
  imported by both the evaluator and `domHost`. `eval` stays forbidden in `src/interp/`.
- The error style follows `necrotalk.md` (`Line N: <message>.`, the offending token named, no internal token or
  AST names leaked).
- The sound is a 1-bit square-wave tone at the beep's volume (`retro-ui.md`); no gradients of sound, no second
  instrument.

---

## Resolved decisions

These were the spec's open questions; the reviewer settled them.

1. The Cursed Manor: add a minimal `openCard` containing only the `play` line where none exists. None of the
   Manor's five cards has an `openCard` today, so this spec adds exactly two: the title theme on `Entrance` and the
   sting on one scary card (`Cellar`). This is a script-only change inside existing cards; no object is added.
2. Duration letters are exactly `w h q e s` (whole, half, quarter, eighth, sixteenth). No dotted or triplet
   durations.
3. The inter-note gap is a fixed 10 ms subtracted from each note's sounding length, with the sounding length never
   dropping below half the note's full length (so very short notes still sound).
4. `play stop` with nothing playing is a silent no-op; it never errors.
5. The e2e asserts one or more oscillators were scheduled, not an exact count.
6. `tempo` is only a prefix to a melody; `play tempo 160` with no notes operand is a parse error (REQ-1.1
   criterion 5).
