# NecroCard — Kiroween 2026 submission

Category: Resurrection. Live at **https://necrocard.onrender.com**.

This document and the README are the written submission. Everything here is drawn from the repository: the full
session log in [`KIRO_USAGE.md`](../KIRO_USAGE.md), the `.kiro/` directory (steering, specs, hooks, the custom
agent, `settings/mcp.json`), [`README.md`](../README.md), [`docs/BRIEF.md`](BRIEF.md), and the test suites. Where a
question has no honest answer from the log, the document says so rather than padding.

## Part 1 — Project description

NecroCard is HyperCard in the browser, with an agent that writes the first draft of a stack from a plain-English
description. HyperCard (1987 to 2004) let anyone build interactive software by stacking cards, dropping buttons and
fields on them, and writing short English-like scripts. NecroCard brings that model back and adds the one thing 1987
did not have: an author that writes a working stack for you and keeps every object and script editable.

It is for people who want to make a small interactive thing — a quiz, a choose-your-own-adventure, a flashcard deck,
an interactive zine — without learning a framework, and for teachers and tinkerers who remember HyperCard. The
problem it solves is the blank page: the HyperCard model is still the most approachable way to describe interactive
software, but someone still has to build the first version.

The main features:

- **Stacks and cards.** A stack holds a shared background and a sequence of cards; each card carries buttons,
  fields, and images, each with properties and a script. The whole stack serializes to one JSON document with a
  lossless round-trip.
- **Backgrounds.** Shared objects and scripts for the cards that use them, with an Edit Background mode so shared
  controls such as Next and Prev are editable.
- **NecroTalk.** A frozen HyperTalk subset: handlers and object → card → background → stack message passing,
  navigation, `put`/`get`/`set`, `if`/`repeat`, `answer`/`ask`, visual effects, `show`/`hide`/`beep`, and a
  one-voice `play`. The interpreter is DOM-free and reports `Line N:` errors.
- **Summon.** Type a description; an agent returns stack JSON that is validated against the schema and whose every
  script is parsed against the real NecroTalk interpreter, with one retry on the error list before it loads.
- **Explain and Fix.** From the script editor, send a script (and its error) to the agent to explain it or propose a
  one-undo fix.
- **Link sharing.** The whole stack is deflated and base64url-encoded into the URL fragment; no server storage.
- **The library.** A named list of the person's own stacks in the picker, backed by localStorage, saved
  automatically, renamed through the inspector, with a Delete button.
- **1-bit retro skin.** A black-on-white Macintosh System 6 look with dither patterns, open-licensed bitmap-style
  fonts, and stepped DOM transitions (no smooth fades).
- **Play.** Browse mode runs the scripts; the three bundled sample stacks (quiz, adventure, flashcards) run with no
  server and no AI calls.

## Part 2 — How Kiro was used

The numbers below are counted from `KIRO_USAGE.md` as of 2026-11-05.

### 1. Surfaces

The CLI did nearly all the work: generating the steering docs, writing and executing all 12 specs, creating the
hooks and the custom agent, and driving every Playwright MCP run. Most CLI sessions cite a live test count from a run
in that same session.

Kiro Web was used for the README review against the repository (2026-11-05). Its network access was
repository-only: `npm ci` failed with a 403 from the registry, so unlike the CLI sessions the Web session could not
install packages, run the suites, or do an MCP run. It verified on-disk file counts directly (73 unit test files, 9
Playwright spec files) and relied on an out-of-session Vitest and Playwright run on commit f2790a0 for the 1079 unit
/ 29 e2e totals.

The IDE's main advantage over the CLI was visibility. Kiro's changes appeared as a diff next to the file instead of
scrolling past in the terminal, so reviewing a 2,000-word draft meant reading it in place, accepting it, and asking
for a targeted fix in the same window. Having the log, the brief and the draft open side by side made it quicker to
check a claim against its source. The CLI stayed the better fit for long implementation sessions with hooks and
test runs; the IDE was the better fit for reviewing and correcting text.

### 2. Custom agents

One custom agent: `necrotalk-reviewer` (`.kiro/agents/necrotalk-reviewer.md`). It is read-only (its only tool is
`read`, with `includeMcpJson: false` and `includePowers: false`). It loads BRIEF section 4 and
`.kiro/steering/necrotalk.md` as the authoritative frozen grammar, reads the code under `src/interp/`, and reports
grammar additions, deviations, early Phase 2 work, out-of-scope features, error-message-format problems, and
module-boundary violations, ending every review with PASS or FINDINGS.

It was used on the interpreter. Its first run, on code that already had 198 passing tests, returned 19 findings
(2026-11-03). The real ones included: custom handlers could not be called by name though the frozen grammar requires
it; a single-line `else if` could close an if block without `end if`; misplaced `pass`/`exit repeat` escaped as
internal exceptions instead of `Line N:` errors; two error messages leaked AST node names. Across four review
rounds it found the spec's biggest gap — nothing could read a field's text in an expression, so
`put field "Score" + 1 into field "Score"` was impossible — plus `me` resolution, a fractional card index reaching
the host, and `constructor(1)`/`__proto__(1)` resolving JavaScript prototype internals instead of failing as unknown
functions. A later follow-up change (host error lines and implicit globals) ran the reviewer again; it found no code
defect but a documentation conflict in the brief. The log's conclusion: a read-only reviewer comparing code to a
written contract found more real defects than the test suite did, at a fraction of the credit cost of a full agent.

### 3. Agent hooks

Three hooks live in `.kiro/hooks/`:

- **Run tests on src save** (`test-on-save.json`): on `PostFileSave` matching a path under `src/`, runs `npm test`.
- **Typecheck and lint before finishing** (`typecheck-lint-before-finish.json`): on `Stop`, runs `npm run check`
  (typecheck and lint). An `npm run check` script was added because PowerShell 5.1 cannot run `&&` chains while
  npm's cmd shell can. The log notes Kiro cannot make a finish hook blocking, so it reports instead.
- **Task-done chime** (`task-done-chime.json`): on `Stop`, plays a short rising three-note chime.

A concrete case: during spec 3's execution (2026-11-03, tasks 1 to 9), the save hook ran the suite on every file
change and the Stop hook ran typecheck and lint before each report, which is how the per-task checks stayed green
(395 tests at that point). The clearest value in the log came from the reviewer agent rather than the hooks; the
hooks' role is keeping the suite and the typecheck/lint gate running automatically across the spec executions.

### 4. Spec-driven development

Twelve specs live in `.kiro/specs/`: stack-model, necrotalk-interpreter, browse-mode, edit-mode, script-editor,
summon, sharing, retro-skin, stack-library, edit-background, necrotalk-play, and single-service-hosting. Each has
`requirements.md`, `design.md`, and `tasks.md`. Requirements are numbered groups (REQ-N); design is a module map
with open questions carrying defaults; tasks are ordered with an acceptance check each.

The flow was brief → steering → spec. The brief (`docs/BRIEF.md`) is the hand-written input; one CLI prompt turned
its 14 sections into the five steering docs; each spec was then generated from named brief sections plus the
relevant steering, reviewed as a document, revised, and only then executed. The payoff was catching defects in a
design document rather than a debugger. In stack-model the design review caught three run-time failures before any
code (a `$ref` + `additionalProperties: false` schema that rejects every object, a forbidden `format: "date-time"`,
and an ASCII-only `fc.string()`). In necrotalk-interpreter the review turned synchronous dialogs async and added an
ObjectRef node before execution; both would otherwise have been multi-day refactors.

The log also has a few `vibe` entries (no spec): the two between-spec fix sessions on 2026-11-04 (summon id repair
and the "your copy" label; background buttons unclickable and script-editor selection paint) and the 2026-11-05
README pass. These were short, prompt-written responses to a real failure, screenshot, or review, with no
requirements/design/tasks cycle. The contrast in the log is explicit: the spec work found bugs by reading a written
contract; the vibe work reacted to something already observed.

One spec breaks the pattern and the log says so plainly: `single-service-hosting` (spec 12). Its code was not
written in this Kiro session — it arrived as an uncommitted working-tree draft produced outside Kiro — and the spec
was written after the code to document what the draft does.

### 5. Steering

Five steering docs in `.kiro/steering/`: `product.md`, `tech.md`, and `structure.md` are always on; `necrotalk.md`
(`inclusion: fileMatch`, `src/interp/**`) and `retro-ui.md` (`inclusion: fileMatch`, `{src/ui/**,**/*.css}`) are
conditional. One CLI prompt generated all five from the brief, including module import boundaries and an
error-message format the brief had not spelled out.

The strategy that mattered most was the frozen NecroTalk subset (BRIEF section 4) mirrored into the conditional
`necrotalk.md`. Freezing the grammar as a written contract is what let the read-only reviewer agent check code
against it, and it is what Summon validates every generated script against. An example where steering improved a
response: the `necrotalk.md` error-message format (`Line <N>: <message>.`) is what let the reviewer flag messages
that leaked internal names — such as `constructor`/`__proto__` resolving JS internals, and errors exposing AST node
names — as format violations rather than letting them pass.

### 6. MCP

One MCP server: Playwright, in `.kiro/settings/mcp.json`, configured for Windows (`cmd /c npx -y @playwright/mcp@latest`,
auto-approving `browser_navigate` and `browser_take_screenshot`). It enabled driving the running app in a real
browser — navigation, snapshots, `browser_evaluate` reads, clicks, and screenshots — as a human-readable check
alongside the committed Playwright e2e tests. The log notes Kiro could not write the settings file itself (a
workspace permission rule blocks `.kiro/settings/`), so it verified the launch command and the human created the
file from Kiro's content.

A concrete session: the browse-mode smoke run (2026-11-03) against `http://localhost:5173/?stack=quiz`. Kiro drove
`browser_navigate`, then `browser_snapshot` and a `browser_evaluate` read of `data-card-name` after each
`browser_click` (the accessibility snapshot does not expose data attributes, which is why the evaluate step was
needed). Cards were seen in order Title → Q1 → Q2 → Q3 → Results, `data-busy` returned to false each time, and the
Results card read "You survived the Haunted Quiz!"; the screenshot was committed at
`docs/screenshots/browse-quiz-results.png`. MCP runs also exposed real bugs across later specs — the same-document
share-link case, the unclickable background buttons, and the script-editor selection paint.

### 7. Property-based testing

fast-check drives the property tests in the Vitest suite. Requirements with properties, by spec:

- **stack-model**: serialization round-trip is identity.
- **necrotalk-interpreter**: parse → print → parse is stable; `put` then read returns the same value; navigation
  never leaves the valid card range (three property tests at 200 runs each).
- **browse-mode**: navigation index range, property round-trip, scale bounds, and transition-coverage monotone
  (four tests at 200 runs).
- **edit-mode**: undo and redo are byte-exact across the fixtures (200 cases each).
- **edit-background**: each random edit applied on a randomly chosen layer still undoes and redoes byte-for-byte.
- **script-editor**: highlight spans concatenate back to the exact source.
- **summon (id repair)**: four properties including idempotence.
- **necrotalk-play**: format → parse round-trip, and every frequency a power-of-two-twelfth of 440.

PBT caught issues unit tests missed, cited from the log. The round-trip test in stack-model found on its first run
that `fc.date` generates pre-year-1000 dates whose `toISOString()` output fails the schema's `^\d{4}-...Z$` pattern
(fixed by constraining the generator). The parse/print/parse property found printer bugs during interpreter
execution: `-(-b)` printed as `--b` (which the tokenizer reads as a comment), and `a is (not b)` printed without
parens and re-parsed as the `is not` operator.

### 8. Kiro powers

No Kiro power was used. The word "powers" appears in the log only in the header template of the questions to answer,
and the custom agent is configured with `includePowers: false`. There is no honest claim of a power being used, so
none is made.

## Summary

NecroCard is a browser HyperCard with an agent (Summon) that writes editable stacks, validated against the real
NecroTalk interpreter, in the Resurrection category, live at https://necrocard.onrender.com. As of 2026-11-05 the
CLI did nearly all the Kiro work; Kiro Web was used for the README review and the IDE to draft this submission, and
Crew was not used. It used one read-only custom agent (necrotalk-reviewer), three hooks, five steering docs (two
conditional), one MCP server (Playwright), spec-driven development across 12 specs with a few vibe fixes, and
fast-check property tests that caught edge cases the unit tests missed. No Kiro power was used. Spec 12's code was
written outside Kiro, and the log states that plainly.
