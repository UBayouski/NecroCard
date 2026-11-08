# necrotalk-play — Tasks

Implementation plan. Each task is self-contained and test-backed; later tasks build on earlier ones. The six
standard checks (`npm run typecheck`, `lint`, `test`, `build`, `server:build`, `e2e`) must be green before a task
is done, and the protected areas (`src/model/`, `server/`, `src/share/`, `src/ui/edit/`, and `package.json`
dependencies) must stay unchanged throughout. Fixtures change only as REQ-7 allows.

References in brackets point at the design (§) and requirements (REQ-) sections.

---

- [x] 1. Notes module (`src/interp/notes.ts`, pure) + tests (REQ-2, REQ-6.2, design §2, §8.2)
  - Done: `src/interp/notes.ts` (imports nothing) exports `Note`, `NoteParseError`, `parseNotes`, `formatNotes`; `notes.test.ts` has the unit cases (including `b`/`bb`/`cb`) and two fast-check properties at 300 runs each; commit dacff7a.
  - Create `src/interp/notes.ts`: `Note` (`{ frequency: number | null; beats: number }`), `NoteParseError`
    (carries the offending token, no line), `parseNotes(source): Note[]` (sticky octave default 4 / duration q,
    `#`/`b`, rests, case-insensitive, `a4`=440, empty → `[]`, bad token throws), `formatNotes(notes): string`
    (canonical, octave/duration emitted only on change).
  - `notes.test.ts`: the REQ-6.2 units; the `b`-vs-flat case (`b`=B, `bb`=B-flat, `cb`=C-flat); fast-check ≥ 200
    round-trip `parseNotes(formatNotes(x)) deep-equals x`; fast-check pitch `log2(f/440)*12` integer within
    tolerance, rests null.
  - No import of the tokenizer/parser; pure.
  - _Requirements: REQ-2.1, REQ-2.2, REQ-2.3, REQ-6.2_

- [x] 2. Tokenizer keywords + test (REQ-1.2, design §3.1)
  - Done: `'play', 'tempo', 'stop'` in `KEYWORDS` (`tokenizer.ts`); `tokenizer.test.ts` keyword case; the optional highlight test exists in `src/ui/script-editor/highlight.test.ts`; commit dacff7a.
  - Add `'play'`, `'tempo'`, `'stop'` to `KEYWORDS` in `src/interp/tokenizer.ts`.
  - `tokenizer.test.ts`: the three tokenize as keywords; a notes string is a normal string token.
  - Confirm the script-editor highlighter needs no change (it reads `interp/tokenizer`); a highlight test asserting
    `play` colours as a keyword is a nice-to-have.
  - _Requirements: REQ-1.2_

- [x] 3. AST + parser + printer for `play` (REQ-1.1, REQ-1.3, design §3.2–3.4)
  - Done: `PlayStatement` in `ast.ts`, parse and print cases in `parser.ts`; `parser.test.ts` "play statement" block (four forms, two parse errors, explicit print round-trip examples) and `ast.test.ts` narrowing case; commit dacff7a.
  - `ast.ts`: add `PlayStatement` (`kind:'play'`, `line`, `action:'stop'|'notes'`, optional `notes`/`tempo`
    expressions); add to `StatementNode`.
  - `parser.ts`: parse `play stop`, `play [tempo <expr>] <expr>` next to `beep`; the notes expression is required
    (its absence, and `play tempo <expr>` with no notes, are parse errors with line + offending token). Printer
    case for the three forms.
  - `parser.test.ts`: the four parse forms and the two parse errors; `ast.test.ts`: `PlayStatement` narrows on
    `kind`. Fold `play` into the parse→print→parse PBT (or add explicit printer round-trip examples).
  - _Requirements: REQ-1.1, REQ-1.3, REQ-6.1_

- [x] 4. Host interface + evaluator execution + tests (REQ-3, REQ-6.3, design §4)
  - Done: `play`/`stopSound` on `HostInterface` and the `play` case in `evaluator.ts` (default tempo 120, bad tempo and bad note are line errors raised before `host.play`); recording stubs in `evaluator.test.ts` and `messageQueue.test.ts`; `evaluator.test.ts` covers each listed case; commit dacff7a.
  - `evaluator.ts`: add `play(notes: Note[], tempo: number): void` and `stopSound(): void` to `HostInterface`
    (import `Note` from `notes.ts`); execute `PlayStatement`: `stop` → `hostCall(line, host.stopSound)`; `notes` →
    resolve tempo (default 120, positive-finite check else runtime error), eval notes expr, `parseNotes` (catch
    `NoteParseError` → `NecroTalkError` at the line naming the token), then `hostCall(line, () => host.play(...))`.
    The error is raised before any `host.play` call.
  - Update the interpreter test mock hosts (`evaluator.test.ts`, `messageQueue.test.ts`) with recording
    `play`/`stopSound` stubs so `tsc` passes.
  - `evaluator.test.ts`: a recording host checks `play "c e g"` → one call (3 notes, tempo 120); `play tempo 160
    "c"` → tempo 160; two plays → two calls; `play stop` → `stopSound()`; `play "h9"` → `NecroTalkError` at the
    line, no `play` call; a bad tempo → runtime error.
  - _Requirements: REQ-3.1, REQ-3.2, REQ-3.4, REQ-6.3_

- [ ] 5. domHost voice + lifecycle stop + tests (REQ-4, REQ-3.3, REQ-6.4, design §5, §8.4)
  - `domHost.ts`: implement `play`/`stopSound`; a `Voice` list scheduled on the shared context; square wave at 0.1
    with attack/release and the 10 ms gap floored at half the note; `playNotes` calls `stopSound()` first
    (replace); `stopSound` silences through the **gain** (`cancelScheduledValues` + set 0 + disconnect), then
    `try osc.stop()` in its own try; `onended` drops finished voices.
  - Move context creation into the one-time `pointerdown`/`keydown` listener (browse layer); `ensureAudio()`
    returns null before the first gesture; `webAudioBeep` uses the same gate; swallow a rejected `resume()`.
  - `BrowseRuntime.stopSound()` pass-through to the current host; `src/main.ts` calls it in `loadStack` and on
    entering Edit (the two places the mode toggle and load live).
  - `domHost.test.ts` (fake `AudioContext`, controllable `currentTime`): scheduled frequencies and tempo-spaced
    start offsets; **stop-before-second-note** cancels and disconnects the future voices' gains; pre-gesture
    `play`/`beep` are no-ops creating no context; post-gesture `play` schedules.
  - _Requirements: REQ-3.3, REQ-4.1, REQ-4.2, REQ-6.4_

- [x] 6. Summon grammar and prompt (REQ-5, design §6)
  - Done: `play` documented with its notes grammar, removed from the "Not supported" line (`item`, `find`, `send` stay) and one `GRAMMAR_EXAMPLES` entry in `grammar.ts`; one prompt sentence in `prompts.ts`; `prompts.test.ts` asserts the example's notes string parses with `parseNotes`; commit dacff7a.
  - `grammar.ts`: document `play "<notes>" | play tempo <n> "<notes>" | play stop` with the one-line notes grammar;
    remove `play` from the "Not supported" line (keep `item`, `find`, `send`); add one short `GRAMMAR_EXAMPLES`
    entry using `play`.
  - `prompts.ts`: one sentence — `play` is optional, melodies under 16 notes.
  - `prompts.test.ts` stays green (every example parses under the real parser; assert the new example's `play`
    string parses under `parseNotes`).
  - _Requirements: REQ-5.1, REQ-5.2_

- [x] 7. Sample fixtures + fixture test (REQ-7, design §7)
  - Done: `play` lines in the nine quiz answer buttons, the Cursed Manor `Entrance` and `Cellar` `openCard` handlers and the four flashcards Flip buttons; `src/interp/fixtures.test.ts` parses every script and runs `parseNotes` on every `play` string; commit dacff7a.
  - Quiz: add a `play` before the `go` in each answer button's `mouseUp` — rising fanfare on a right answer,
    falling pair on a wrong one.
  - Cursed Manor: add `on openCard` to `Entrance` (title theme) and `Cellar` (four-note sting); these are the only
    two `openCard` handlers; no object change.
  - Flashcards: add one short click (`play "c5s"`) to the Flip button's `mouseUp` alongside `show field "Answer"`.
  - A fixtures test parses every script with the real parser and runs `parseNotes` on every `play` string; the
    schema validation and the model/interp PBT suites stay green. No object/card/property change.
  - _Requirements: REQ-7.1, REQ-7.2, REQ-7.3, REQ-7.4_

- [x] 8. End-to-end (`test/e2e/play.spec.ts`) (REQ-8.1, design §8.6)
  - Done: `test/e2e/play.spec.ts` stubs `AudioContext` with `addInitScript`, answers a quiz question and asserts positive frequencies, empty alert and no console error; it passed in a full `npm run e2e` run (30 passed) with `browse.spec.ts` and the rest; commit dacff7a.
  - `addInitScript` stubs `AudioContext` before load, recording created oscillators and frequencies.
  - Open the quiz, click an answer (the gesture), assert the stub saw ≥ 1 oscillator with positive frequencies and
    that there is no `role="alert"` text and no console error.
  - Confirm `browse.spec.ts` and the other e2e still pass.
  - _Requirements: REQ-8.1_

- [ ] 9. Full verification and the Playwright MCP run (REQ-8.2, design §8.7)
  - Run the six checks; confirm the protected areas and `package.json` deps are unchanged and no file is over ~300
    lines.
  - One MCP run against the dev server (running on http://localhost:5173): open the quiz, click through to a right
    answer, read the console (only the expected `/api/health` 502; no AudioContext warning). Confirm the melody
    scheduled via a short `browser_evaluate`. No screenshot. Clear `localStorage` if a sample fork left a library
    copy.
  - Write the run entry in `KIRO_USAGE.md`.
  - _Requirements: REQ-8.2, REQ-9_
```
