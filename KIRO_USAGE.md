# Kiro Usage Log

Running log of how Kiro was used to build NecroCard. One entry per session. This becomes the Kiroween write-up.
Judges ask about: surfaces (IDE / CLI / Web / Crew), custom agents, hooks, specs vs vibe coding, steering, MCP,
property-based testing, powers. Tag each entry with the relevant ones.

Format:

```
## YYYY-MM-DD — short title
Surface: CLI | IDE | Web | Crew
Features: spec | steering | hook | mcp | agent | pbt | power | vibe
What I asked for:
What Kiro did:
What changed because of it (time saved, bug caught, decision made):
```

---

## 2026-11-03 — Repo created, brief written
Surface: none yet (scaffold written by hand before the first Kiro session)
Features: none
What I asked for: n/a
What Kiro did: n/a
What changed: Product brief at docs/BRIEF.md is the input for the first Kiro session (steering docs, then first spec).

## 2026-11-03 — Steering docs generated from the brief
Surface: CLI (Kiro CLI 2.37.1, V3 engine, Auto model)
Features: steering
What I asked for: "Read docs/BRIEF.md. Generate steering docs for this project: product.md, tech.md, structure.md.
Then add necrotalk.md with a fileMatch on src/interp/** and retro-ui.md with a fileMatch on src/ui/** and **/*.css."
What Kiro did: Produced five steering files in .kiro/steering/. Three always-on: product.md (object model, HyperCard
fidelity rules, Summon pipeline, non-goals, milestones), tech.md (TypeScript + Vite, no framework, no eval, three-phase
interpreter, Vitest + fast-check + Playwright, pinned deps, planned hooks and MCP), structure.md (folder layout, naming,
module import boundaries, spec-to-folder map). Two conditional: necrotalk.md on src/interp/** (full frozen grammar,
module split, error message format, PBT targets, message-passing order) and retro-ui.md on src/ui/** and *.css
(1-bit rules, dither patterns, fonts, card scaling, transitions, buttons, fields, edit affordances, accessibility).
What changed: One prompt turned a 14-section brief into enforceable per-file rules, including module import boundaries
and an error-message format I had not spelled out. Review found four things to correct before writing specs: Kiro
introduced a `pass` command in the message-passing rules that was missing from the grammar (kept it, added to the
brief); it specified canvas-rasterized transitions for a DOM-rendered card, which is not feasible (changed to stepped
clip-path and dither-mask effects); it named Apple's proprietary fonts as requirements (changed to open-licensed
lookalikes, a hackathon rules issue); and it required buttons to be rendered as div elements, which conflicts with its
own accessibility section. Corrections applied through a follow-up Kiro prompt rather than by hand.

## 2026-11-03 — Steering revision 2
Surface: CLI
Features: steering
What I asked for: Apply five corrections to the steering docs (add `pass` to the grammar, stepped DOM transitions
instead of canvas rasterization, open-licensed fonts only, real `<button>` elements, `.kiro/settings/` and short ids).
Then a second pass to remove one stale "canvas effects" line that survived.
What Kiro did: Edited the five files in place without rewriting them. Left one contradictory bullet in retro-ui.md on
the first pass; fixed it on the second.
What changed: Steering is now internally consistent before any spec was written. Lesson: grep the steering set after
every revision; Kiro edits the section you point at and can miss a restatement elsewhere in the same file.

## 2026-11-03 — Spec 1: stack-model (requirements, design, tasks)
Surface: CLI (Auto model)
Features: spec, pbt
What I asked for: "Create a spec named stack-model based on sections 3 and 12 of docs/BRIEF.md and the product and
structure steering. Requirements must cover the types, the JSON schema, lossless round-trip serialization, short
URL-safe object ids, and three sample stacks in fixtures/. Enable property-based testing on the round-trip requirement."
What Kiro did: Produced requirements.md (6 requirement groups, 290 lines), design.md (module map, id generator with
zero modulo bias, canonical sorted-key JSON, fast-check arbitrary design, fixture sketches), tasks.md (10 ordered
tasks with acceptance checks). Added things I had not asked for that turned out to matter: canonical key ordering for
share-URL caching, a discriminated union on `type`, and a unique-id pool for the PBT arbitraries.
What changed: Reviewing the design before execution caught three defects that would have failed at run time:
(1) `$ref` to a base schema combined with `additionalProperties: false` rejects every valid object, fixed with
`unevaluatedProperties: false`; (2) `format: "date-time"` needs ajv-formats, which the requirements forbid, replaced
with a regex; (3) `fc.string()` is ASCII-only, replaced with `fc.string({ unit: 'grapheme' })`. Also removed a
premature Playwright install and added a missing ESLint config to task 1. All five fixes applied by Kiro from one
revision prompt. This is the concrete spec-versus-vibe argument: the bugs were found in a design document, not in a
debugger.

## 2026-11-03 — Spec 1: stack-model executed (tasks 1 to 10)
Surface: CLI (Auto model)
Features: spec, pbt, hooks (none yet)
What I asked for: Approve the spec and execute tasks.md in order, stopping after each acceptance check.
What Kiro did: All 10 tasks completed. Created the Vite + TypeScript project (pinned deps: typescript 6.0.3, vite
8.3.5, vitest 5.1.0, fast-check 4.10.2, eslint 10.14.0, ajv 8.20.0), `src/model/` with types, id generator, JSON
Schema, ajv validator, canonical serializer, fixture loader, co-located tests, and three fixture stacks (quiz,
adventure, flashcards). Kiro's own notes on what happened during execution:
- Task 1: set `passWithNoTests: true` in the Vitest config so `npm test` exits 0 before any tests exist.
- Task 4: ajv `strictTypes` had to be disabled for a `$ref`-only root schema. Documented in validate.ts.
- Tasks 6 and 7: the property-based round-trip test immediately found a real bug. `fc.date({ noInvalidDate: true })`
  generates pre-year-1000 dates whose `toISOString()` output does not match the `^\d{4}-...Z$` schema pattern.
  Fixed by constraining the date arbitrary to a minimum of 1000-01-01.
- Task 10: ESLint caught an unused function stub left from the PBT draft; removed.
What changed: First working code, generated from an approved spec with acceptance checks per task. PBT paid for
itself on the first run by finding an edge case (years below 1000) that a hand-written unit test would not have
covered. Note for the write-up: the fix constrained the generator rather than the schema, which is the right call
since the app never produces such dates, but it is worth stating explicitly as a deliberate scoping decision.

## 2026-11-03 — Spec 2: necrotalk-interpreter (requirements, design, tasks)
Surface: CLI, model switched from Auto to claude-sonnet-4.5 (1.3x) for this spec's documents
Features: spec, pbt, steering (necrotalk.md conditional steering active)
What I asked for: Spec from BRIEF section 4 and the necrotalk steering: tokenizer, recursive-descent parser, AST
printer, tree-walking evaluator with message passing and `pass`, a host interface so the evaluator has no DOM
dependency, line-numbered errors, PBT on parse/print/parse, put/read, and navigation range.
What Kiro did: 465-line requirements, 455-line design, 17 tasks. Review before execution found two architectural
problems and several gaps, all fixed by one revision prompt (also on Sonnet):
- Dialogs were synchronous (`answer(): string`), which only works with window.prompt and the retro-ui steering
  forbids that. Evaluator made async from the start; retrofitting later would touch every statement and test.
- Object references were bare strings, so `show field "Answer"` and `set the label of button "X"` could not be
  represented, even though the fixtures already use them. Added an ObjectRef node carried through to the host.
- Printer had no parenthesization rule, so the round-trip PBT would have failed on `(1 + 2) * 3`.
- No line numbers on AST nodes, so runtime errors could not satisfy the steering's `Line N:` format.
- Navigation semantics undefined; added a pure resolveNavigation with HyperCard wrap-around and errors.
- No guard against `repeat while true`; added a 100,000-statement execution budget.
- Variable semantics undefined; made names case-insensitive, unset variables evaluate to their own name.
Spec grew to 1,654 lines after revision.
What changed: The model choice was deliberate and it cost most of the free plan's 50 credits. The sync-to-async and
ObjectRef catches alone justified it; both would have been multi-day refactors if found during execution.

## 2026-11-03 — Spec 2 executed (tasks 1 to 17), interrupted by credit exhaustion
Surface: CLI, back on Auto
Features: spec, pbt
What I asked for: Execute tasks in order. Stopped after Task 2 when the free plan ran out (49.38 of 50 credits).
Resumed next morning with: "Continue from Task 3 and run through Task 17 without stopping between tasks. Only stop if
a task's acceptance check fails twice in a row."
What Kiro did: Delivered the full interpreter: ast, errors, tokenizer, parser with printer, navigation, evaluator,
messageQueue, plus a fixtures smoke test. 11 test files, 198 tests, three PBTs at 200 runs each, typecheck, lint,
and build all clean, no forbidden imports. The parse/print/parse PBT found real printer bugs during execution, visible
in the regression tests Kiro added afterwards: `-(-b)` printed as `--b`, which the tokenizer reads as a comment;
`a is (not b)` printed without parens and re-parsed as the `is not` operator; unary and chunk expressions needed their
own parenthesization rules beyond the binary-operator rule in the design.
What changed: The interpreter exists and is testable in Node with a mock host. Lesson on credits: a 17-task spec on
Auto costs roughly as much as the free plan allows per month; the hackathon credit grant is the real budget.
Known small deviations from HyperCard to revisit later, not blockers: division by zero yields "Infinity" instead of
an error; `contains` is case-sensitive; `toNumber` accepts "12abc" as 12.

## 2026-11-03 — Hooks, MCP, and a custom reviewer agent
Surface: CLI (Auto)
Features: hook, mcp, agent
What I asked for: Two hooks (tests on save under src/, typecheck and lint before finishing a task), Playwright MCP in
.kiro/settings/mcp.json, and a read-only custom agent `necrotalk-reviewer` that checks src/interp/ against BRIEF
section 4 and the necrotalk steering.
What Kiro did: Created .kiro/hooks/test-on-save.json and typecheck-lint-before-finish.json. Added an `npm run check`
script because PowerShell 5.1 cannot run `&&` chains while npm's cmd shell can. Noted that Kiro cannot make a
"finish" hook blocking, so it reports instead. Created .kiro/agents/necrotalk-reviewer.md with only the read tool and
no MCP or Powers, ending every review with PASS or FINDINGS.
What changed: The reviewer's first run on code that already had 198 passing tests returned 19 findings. The important
ones were real: custom handlers could not be called by name even though the frozen grammar requires it; a single-line
`else if` could close an if block without `end if`; misplaced `pass` and `exit repeat` escaped as internal exceptions
instead of `Line N:` errors; two error messages leaked AST node names. The rest were deliberate additions that the
brief had not caught up with (unary minus, `me`, count of lines/chars, nested read-only chunks), so the brief and
steering were updated rather than the code.

## 2026-11-03 — Interpreter hardening through four reviewer rounds
Surface: CLI (Auto)
Features: agent, spec, pbt, steering
What I asked for: Fix the reviewer's bugs, settle the open semantics (field reads in expressions, `me`, reserved
words, answer button limit, arity checks, parse-time rejection of `do` and `sort`), mirror each decision from the
brief into the steering file, and rerun the reviewer until it passes.
What Kiro did: Four reviewer rounds. Round 2 found the biggest gap of the whole spec: nothing could read a field's
text in an expression, so `put field "Score" + 1 into field "Score"` was impossible and the quiz fixture could never
work. Added a FieldExpression node. Also found that `me` could not be resolved because the dispatcher never told the
evaluator whose script was running; MessageContext now carries object, card, background, and stack refs and `me`
follows the message chain. Kiro replaced my ObjectRef-to-host design with a ResolvedObjectRef { type, name } because
names became expressions, which is the right call. Later rounds caught: `go to card 1.5` sending a fractional index
to the host; a lone `"` at end of script tokenizing as an empty string; `constructor(1)` and `__proto__(1)` resolving
JavaScript prototype internals instead of failing as unknown functions; error messages containing raw line breaks
from field text. Final state: 272 tests, three PBTs re-run on extra seeds, typecheck and lint clean. Last remaining
finding was a documentation gap (grouping parentheses not listed in the brief), fixed in the brief.
What changed: A read-only reviewer agent with a narrow brief found more real defects than the test suite did, at a
fraction of the credit cost of a full agent, because it compares code to a written contract instead of running it.
The `__proto__` catch is the kind of thing that only surfaces when something is reading the code with an adversarial
checklist.

Final two rounds (after the brief gained the grouping-parentheses line): the reviewer found four real bugs in
variable scoping that no test had covered. Globals were readable without a `global` declaration while writes went to
a shadow local; `global x` overwrote the stack-wide value with an existing local; `put "*" after stars` on an unset
variable produced `stars***` because unset variables evaluate to their own name even as a put target; reserved words
in expression position gave a generic "Expected an expression". All fixed with regression tests. Reviewer verdict:
PASS. Final counts: 279 tests in 11 files, typecheck and lint clean, property tests re-run on extra seeds.
Two undecided edge cases were left as they are and noted: a keyword at statement start reports Unknown command
rather than reserved word, and a same-line `else <stmt>` is accepted inside a block that still needs `end if`.

## 2026-11-03 — MCP: Playwright server, and a Kiro guardrail
Surface: CLI (Auto)
Features: mcp
What I asked for: Create .kiro/settings/mcp.json with the Playwright MCP server, confirm it loads, take a screenshot.
What Kiro did: Refused, correctly. A workspace permission rule blocks the agent from writing under .kiro/settings/,
and it did not try to route around it via `kiro-cli mcp add`. Instead it verified the launch command on this machine:
on Windows `npx` resolves to `npx.ps1` and there is no `npx.exe`, so a server launched without a shell would fail;
the working form is `cmd /c npx -y @playwright/mcp@latest`, with `-y` so a fresh clone does not hang on npx's
"Ok to proceed?" prompt. It confirmed the package starts, that .gitignore does not exclude the file, and gave me the
exact JSON to create by hand.
What changed: The settings file was created outside Kiro from Kiro's own verified content. Worth stating in the
write-up: the agent cannot edit its own permissions or MCP config, which is the right default, and it spent its effort
on making the human-created file correct the first time. Tool names auto-approved: browser_navigate and
browser_take_screenshot only. MCP servers load at session start, so the first use is in the next session.
Next session: both tools worked. browser_navigate loaded example.com and browser_take_screenshot wrote a PNG without a
permission prompt. Two follow-ups from Kiro: confirm the server was not also coming from a global ~/.kiro/settings/
file (it was not; none exists), and ignore the .playwright-mcp/ output folder (done).

## 2026-11-03 — Spec 3: browse-mode (requirements, design, tasks)
Surface: CLI (Auto)
Features: spec, steering, mcp, pbt
What I asked for: A browse-mode spec from BRIEF sections 3, 5 and 8 plus the product, structure and retro-ui
steering: DOM rendering at 512 by 342 scaled to fit, a DomHost over the existing HostInterface, the four stepped
transitions, 1-bit dialogs, message wiring with the correct `me`, a stack picker, a message box, and a Playwright MCP
smoke test.
What Kiro did: Wrote 1,049 lines across requirements, design and tasks against the real interpreter surface. It
read the evaluator and noticed that `go` targets are already resolved before `goToCard` is called, so the host does
no navigation of its own. It kept the whole spec out of src/interp and src/model, named the one place where that
hurts (host errors carry no line number) and proposed the fix as a separate reviewed change instead of sneaking it
in. The transition design stayed on the stepped-DOM rule from steering: clip-path and transform in whole logical
pixels, eleven precomputed 8 by 8 Bayer masks as SVG data URLs for dissolve, frames driven by requestAnimationFrame
with a time-based index, never a CSS transition. Dialogs are drawn inside the scaled card because showModal() would
sit in the top layer outside the transform. It also listed five open decisions with defaults rather than deciding
silently: no line numbers on host errors, name-only `me`, a generic font fallback until retro-skin, message box
ownership moved from script-editor into this spec, and two new dev dependencies (happy-dom, @playwright/test).
What changed: All five defaults accepted. My review found four things to fix before Task 1. A real bug: buttons use
`all: unset` followed by `display: flex`, and author rules beat the user-agent `[hidden] { display: none }` rule, so
hidden objects would render; the spec needs an explicit hidden rule and a test. A cross-spec conflict: the
interpreter requirements say `the date` is ISO while browse-mode says HyperCard short form `11/3/26`; keep HyperCard
and amend the old line. A coverage gap: all three fixtures have empty backgrounds, so background rendering and the
object to card to background message path must be tested with inline stacks. And Task 1 repeats .gitignore entries
that already exist. The four property tests (navigation index range, property round-trip, scale bounds, transition
coverage monotone) carry over the PBT habit from the interpreter spec.

## 2026-11-03 — Spec 3 executed, tasks 1 to 9 (everything but the browser)
Surface: CLI (Auto)
Features: spec, steering, hook, pbt
What I asked for: Apply the four corrections and the font adjustment to the spec first, then run Tasks 1 to 9 and
stop before the dev server and Playwright steps, reporting test count, deviations from the design, and anything in
src/interp or src/model it wanted to change but did not.
What Kiro did: Amended the spec files before writing code, including the two stale lines in the interpreter spec.
Built scale, object lookup, message context, the four renderers, the stage, transitions, dialogs, DomHost, the
runtime and the message box with co-located tests: 395 tests in 23 files (116 new), the four property tests at 200
runs each, typecheck, lint and build clean. It reported eight deviations from its own design instead of silently
drifting. The important one: the evaluator only exposes a global to a handler that declares it, so a one-line
message box could not share globals with scripts as REQ-7 asked. Rather than touch the interpreter, it made the
wrapper declare every identifier in the typed line as global and shifted the line-number remap to match, which is
also how HyperCard treats message box variables. It also listed five interpreter changes it wanted and did not make,
and confirmed with git diff that src/interp and src/model are untouched. Dev dependencies added, pinned: happy-dom
21.0.4, @playwright/test 1.64.1.
What changed: The "no interpreter changes in this spec" rule held under pressure, which is what makes the reviewer
agent's PASS from the previous spec still valid. Two of the five interpreter wishes (line numbers on host errors, an
implicitGlobals option on evaluate so the message box stops rewriting source) are queued as one small reviewed
change after this spec; the other three are deferred. The save hook ran the suite on every file change; the Stop
hook ran typecheck and lint before each report. I re-ran the suite myself: 395 passing. npm audit reports 11
moderate findings, all one transitive minimatch version in dev tooling.

## 2026-11-03 — Spec 3 finished: chrome, e2e, Playwright MCP smoke (tasks 10 to 12)
Surface: CLI (Auto)
Features: spec, steering, mcp, pbt
What I asked for: Bring the spec and retro-ui steering in line with what was built (interim message-box globals,
load errors labelled with card 1, inline transition and scroll-thumb styles allowed, textarea inside a positioned
div, frame 11 at 333 ms), then run Tasks 10 to 12, including `npm audit fix` with package.json left unchanged.
What Kiro did: Updated requirements, design, tasks and retro-ui.md first, plus two more stale design sections it
found (gestures still described pointer capture). Built the stack picker, chrome CSS and boot code, a committed
Playwright test, and the final checks: 400 Vitest tests in 24 files, typecheck, lint and build clean, `npm run e2e`
green. The e2e test failed once on its own selector: `getByLabel('Stack')` also matched the card's
"HyperCard stack" label, so it switched to the combobox role with an exact name. `npm audit fix` changed nothing:
all 11 findings are one transitive minimatch in the ESLint chain, and the only offered fixes are major downgrades.
Kiro's shell tool refused to start the dev server (a guard against long-running commands), and Kiro did not try to
route around it; I started `npm run dev` myself.
Playwright MCP smoke, driven by Kiro against http://localhost:5173/?stack=quiz: browser_navigate, then
browser_snapshot and a browser_evaluate read of `data-card-name` after every browser_click. The accessibility
snapshot does not expose data attributes, which is why the evaluate step was needed. Cards seen in order:
Title (index 0) → Q1 → Q2 → Q3 → Results (index 4), `data-busy` back to false each time, status line empty, Results
text "You survived the Haunted Quiz!". Screenshot: .playwright-mcp/browse-quiz-results.png, copy committed at docs/screenshots/browse-quiz-results.png (card at 2× integer
scale, roundRect "Try Again" button with its bevel). Console: Vite's two debug lines and one error, a 404 for
/favicon.ico (the browser's automatic request; there is no favicon yet). No script or page errors.
Difference from the committed e2e test: same clicks and the same final assertions; the MCP run adds a human-readable
snapshot trail and a screenshot, while the e2e test also fails on any console error.
What changed: Browse mode works end to end in a real browser on the first MCP run. The screenshot also makes the
retro-skin gap visible: field and button text are anti-aliased sans-serif, the accepted fallback until open-licensed
bitmap fonts land. Small follow-up: add a favicon so the console is clean, or the e2e test's no-console-errors rule
will trip on a stricter run.

## 2026-11-03 — Interpreter follow-up: host error lines and implicit globals (reviewed)
Surface: CLI (Auto)
Features: agent, spec, steering, pbt
What I asked for: The two interpreter debts spec 3 left behind, as one small change with the reviewer in the loop:
host errors rethrown as NecroTalkError at the statement line, and an implicitGlobals option on evaluate so the
message box stops rewriting typed source. Plus a favicon so the e2e console check stays clean.
What Kiro did: Routed all host calls in the evaluator through one wrapper that turns a plain host Error into
`Line N: <message>` and lets NecroTalkError and the internal pass/exit/next signals through unchanged. Added
implicitGlobals: every variable in the called handler, `it` and parameters included, lives in the globals map;
handlers it calls by name keep normal locals, as in HyperCard's message box. messageBox.ts is back to a three-line
wrapper with no tokenizer import. Drew a 16 by 16 two-colour ghost favicon with a throwaway script and added an e2e
assertion that it serves. Reviewer round 1 found no code defect but one documentation conflict (the brief still
called a put target "a local variable", and steering says the brief wins), plus five test gaps; Kiro fixed the brief
and added the tests. Round 2: PASS. 439 Vitest tests in 24 files, 2 e2e tests, typecheck, lint and build clean.
What changed: A broken script in browse mode now reports `Script error in button "Lost": Line 2: No field named
"Missing"` instead of a bare message. The reviewer again earned its keep on documentation drift rather than code:
the brief, the steering and the spec are the contract, and the agent checks the code against all three. One side
effect documented rather than hidden: with implicit globals, a parameter called without an argument sets that global
to empty.

## 2026-11-03 — Spec 4: edit-mode (requirements, design, tasks)
Surface: CLI (Auto)
Features: spec, steering, pbt, mcp
What I asked for: An edit-mode spec from BRIEF sections 3 and 5 and the retro-ui edit affordances: Browse/Edit
toggle, selection with outline and handles, move, resize, nudge, a 240 px inspector with a plain script textarea,
add tools, 1-bit image import, delete, a card menu, one linear undo/redo, all on the same working copy browse mode
runs, with three property tests and a Playwright e2e.
What Kiro did: About 955 lines across the three files and fourteen open decisions with defaults. The design choice
I would not have asked for but agree with: undo stores commands (target ids plus before and after values) rather
than stack snapshots, because a snapshot undo after a Browse session would also wipe what scripts changed. It
noticed that serializeStack sorts keys, so only array order matters for byte-exact undo, and had add/delete restore
the exact index. All edit operations go through one class with no DOM access, so the undo and redo property tests
run in Node with validateStack after every step. Image import needs no library: a hand-written 1-bit PNG encoder
with stored deflate blocks, reusing the Bayer matrix from the browse-mode dissolve. Clicks in edit mode are kept
away from scripts by two guards, an inert card layer and a runtime mode check.
What changed: Thirteen defaults accepted; the image fit size raised from 128 to 256; the drag-ghost line in retro-ui
reworded so the steering does not contradict a live-move drag. One gap found in review: there was no way to create
a stack from scratch, only to edit the three fixtures, which the demo and the later Summon and sharing specs both
need. Added a New Stack action and an editable stack name as one more undoable command.

## 2026-11-03 — Spec 4: edit-mode, end-to-end and Playwright MCP (task 11)
Surface: CLI (Auto)
Features: spec, mcp, pbt
What I asked for: Run the edit-mode e2e tests, then drive the add-button flow once through Playwright MCP with a
selection screenshot and a result screenshot, check the console, and log it here.
What Kiro did: Wrote test/e2e/edit.spec.ts with three tests: on the quiz, add a button whose script is `go next`,
switch to Browse, click it, land on Q1; import a local image (generated with the project's own PNG encoder, so no
fixture file) and check it comes back as a 1-bit grayscale PNG data URL with no request leaving the dev server; New
Stack, add a button that renames itself, click it in Browse, see "Clicked". All five e2e tests (two browse, three
edit) passed on the first run.
Playwright MCP run against http://localhost:5173/?stack=quiz: browser_navigate, click the Edit radio, click
"Add button", browser_take_screenshot, browser_type the script into the inspector's Script textarea, click the
Browse radio, click "Button 1", read data-card-name with browser_evaluate. Result: Title → Q1, status line empty,
runtime not busy. Screenshots: .playwright-mcp/edit-mode-selection.png (Button 1 at 206,159 100×24 with its eight
handles and the button inspector) and .playwright-mcp/edit-mode-result.png (the Q1 card in Browse). Console: Vite's
connect/connected debug lines only, 0 errors, 0 warnings (the favicon 404 from the browse-mode run is gone).
What changed: Two things went wrong during the MCP run and are worth recording. First, the first selection
screenshot showed no selection: the undo history held eight moves and resizes of Button 1, TitleField and
BeginButton that Kiro had not made. The MCP browser is a visible window, and each entry needs a real press-and-drag
on the card, so the likely cause is someone interacting with that window between Kiro's calls; Kiro could not
confirm this. It read the history by stepping back through the Undo titles, and that turned into a live check of the
undo requirement: undoing all nine edits restored TitleField to its fixture size and removed Button 1, and redoing
all nine replayed them exactly. It then reloaded and repeated the flow. Second, on the retry Kiro sent dependent
browser steps in parallel; the "Add button" click raced the mode switch and the screenshot captured the wrong
state. It noticed, said so, and redid the steps one at a time. Lesson for MCP runs: one dependent action per call,
and verify state with browser_evaluate before each screenshot. A small visual finding from the screenshot: the
selection's dashed outline sits exactly on a button's own 2px black border, so the handles are what make a selected
bordered button visible; worth a look in retro-skin.

## 2026-11-03 — Spec 4 executed (tasks 1 to 12): edit mode complete
Surface: CLI (Auto)
Features: spec, hook, pbt, mcp
What I asked for: Apply the five review changes to the spec, run Tasks 1 to 10, stop and report; then, with the dev
server running, Tasks 11 and 12 including the Playwright MCP run of the add-button flow.
What Kiro did: 559 Vitest tests in 36 files (120 new) and 5 e2e tests, all green with typecheck, lint and build.
The undo and redo property tests run 200 cases on each fixture, stack rename included. It reported seven
deviations, all improvements: keyboard editing only when the card has focus (otherwise arrow keys in the mode
toggle would nudge the selection), no Tab-to-indent in the script textarea because it would trap keyboard users,
pointer and key handling split into its own file to stay under 300 lines. Two test failures during the build were
mistakes in its own tests, not the code, and it said so: one test held a reference across delete and undo, but undo
restores a copy by design so history never aliases the working copy; another expected the card not to receive a
new button's mouseDown, but message passing correctly hands it up. Typecheck failed once on Node's Buffer in a
test; it fixed the test rather than add @types/node. The MCP run drove the full flow: Edit, Add button, script in
the inspector, Browse, click, card Title to Q1. Two screenshots, copies committed in docs/screenshots/.
What changed: The two MCP incidents (the unexplained undo history, which was me using the visible MCP window after
suggesting edit mode at that address, and the dependent steps sent in parallel) and the selection-outline note are
in the Task 11 entry above and are not repeated here. Interpreter and model untouched, no new dependencies.

## 2026-11-03 — Spec 5: script-editor (requirements, design, tasks)
Surface: CLI (Auto)
Features: spec, steering, pbt
What I asked for: A script editor with no new dependencies: highlighting driven by the interpreter's own tokenizer
with no second lexer, a line gutter, inline parse errors on a debounce, Ctrl+] and Ctrl+[ indent so Tab keeps moving
focus, message box highlighting and history, and Explain and Fix behind an AgentClient interface with a stub until
the summon spec provides the real client, with Fix shown as a line diff and applied as one undoable command.
What Kiro did: 668 lines across the three files and twelve open decisions. The highlighting design is the part
worth reading: every span is sliced from the source by the token's column rather than taken from its value
(keywords are lowercased in value), comments are recovered from the gaps because the tokenizer skips exactly
whitespace and `--` comments, and a test asserts every gap span starts with `--` so a future tokenizer change fails
loudly rather than mis-colouring. Lines are tokenized one at a time so a half-typed string only marks its own line.
A property test checks the spans concatenate back to the exact source for both valid scripts and arbitrary strings.
The mirror layer uses colour only, no bold or italic, so glyph widths match the transparent textarea exactly, and
every colour was checked against 4.5:1. Indent uses the browser's own insertion path so the textarea's native undo
still works.
What changed: Eleven defaults accepted. One overridden: the AgentClient interface moves to src/summon/ rather than
src/ui/agent/, because the Summon prompt panel in spec 6 will have to call src/summon from the UI anyway, so the
dependency direction is UI consumes, summon provides, and structure.md is amended once to say so. One addition for
the demo: an Expand button that moves the same editor element into a wider chrome dialog and back, so state and
commit rules are untouched.

## 2026-11-03 — Spec 5: script-editor, Chrome findings, e2e and Playwright MCP (tasks 7 and 8)
Surface: CLI (Auto)
Features: spec, mcp, pbt, steering
What I asked for: Fix two findings from my own check in Chrome, then run the script-editor e2e test and one
Playwright MCP pass of the same flow (one dependent action per call) with screenshots of the inline error and the
Expand dialog, and close the spec.
The two Chrome findings (mine, not Kiro's) and how Kiro fixed them:
1. Selected text was invisible. The textarea's `::selection` used an opaque colour that covered the highlighted
   mirror behind the transparent text. Kiro switched both the script editor and the message box to
   `rgba(201, 211, 238, 0.55)`, and added a CSS test that both selection backgrounds have alpha strictly between 0 and
   1 (the message box had no selection rule at all before).
2. Ctrl+Z after Ctrl+] selected the whole line, because indent replaced the entire line range in one `insertText`.
   Kiro changed `shiftLines` so a single-line indent inserts only two spaces at a caret on the line start, and a
   single-line outdent selects just the leading spaces and runs `execCommand('delete')`; multi-line selections keep
   the whole-range replace. The unit tests check the exact replacement and the caret after each path, and that the
   minimal edit reproduces the full result. Since happy-dom cannot run native undo, the editor test records the
   command and selection the browser would act on.
What Kiro did: test/e2e/script-editor.spec.ts with four tests, all green in Chromium on the first run: a broken
handler (`end mouseDown`) shows `Line 3: Expected "end mouseUp" but found "end mouseDown".` within a second, with
`aria-invalid`, a `!3` gutter marker and the line-3 underline; fixing it gives `No errors`, and clicking in Browse
reaches Q1. Fix with the stub client puts `Summon is not configured` in the status line. Two tests check the Chrome
findings in a real browser, which happy-dom could not: Ctrl+] then Ctrl+Z leaves a caret (this would have failed
before the fix), and the computed `::selection` background on both controls is translucent.
Playwright MCP run against http://localhost:5173/?stack=quiz, one dependent action per call with a
browser_evaluate state check before each screenshot. Edit, open BeginButton's script, type the broken handler, wait,
check, screenshot .playwright-mcp/script-editor-error.png (highlighted code, `!3` gutter marker, wavy underline,
message below). Expand, check that it is the same textarea (`script-4`), a single `.code-editor` on the page, 24
rows, error kept; screenshot .playwright-mcp/script-editor-expanded.png. Fix the line inside the dialog, Close: the
same editor is back in the inspector at 10 rows, `No errors`, focus on the Expand button. Browse, click "Enter if you
dare...", Q1. Console: 0 errors, 0 warnings (Vite connect lines and two CSS hot-update lines only).
What changed: The two findings are a fair lesson about what unit tests in a fake DOM can and cannot see: both were
correct by every happy-dom test and wrong in Chrome. Each now has a real-browser e2e check. The MCP run found one
more small thing: the Expand dialog's title read "Script: Script" because it used the slot's label; Task 8 changes
it to name the owner, e.g. `Script of button "BeginButton"`. Also noted: closing the dialog by clicking Close blurs
the textarea, so the normal blur rule commits the edit (as specified; Close itself commits nothing). The double-click
that opens the script was dispatched to the edit overlay with browser_evaluate, because an MCP click on the covered
button's ref fails Playwright's actionability check; the committed e2e test performs a real double-click.

## 2026-11-03 — Spec 5 closed: human check in Chrome, two real-browser bugs, MCP run
Surface: CLI (Auto)
Features: spec, mcp, hook
What I asked for: Tasks 1 to 6, stop, then a human check of the two things Kiro said happy-dom could not prove
(mirror alignment with the transparent textarea, native undo after the indent shortcut), then the e2e and MCP tasks.
What Kiro did: 631 Vitest tests in 44 files and 9 e2e tests, all green with typecheck, lint and build. The two
Chrome findings, their fixes, the real-browser e2e tests and the MCP run are in the entry above. New here: the human
check confirmed the two things Kiro had said happy-dom could not prove (mirror alignment under the transparent
textarea, native undo after the indent shortcut) before it found the two bugs, and Kiro noted a second NecroCard tab
it had not opened in the MCP browser and worked only in its own.
What changed: The pattern for this project is now settled: Kiro proves what it can in happy-dom, says plainly what
it cannot, a human checks that in a real browser, and the fixes come back with real-browser e2e tests so the gap is
closed for good. Caret position after undo lands at the line start, which is inherent to using the browser's own
undo stack rather than the editor's, and was accepted. Screenshots copied to docs/screenshots/.

## 2026-11-03 — Spec 6: summon (requirements, design, tasks)
Surface: CLI (Auto)
Features: spec, steering
What I asked for: a `summon` spec from BRIEF sections 6 and 9 with two overrides decided before the prompt: Google
Gemini through the AI Studio REST API instead of the brief's unspecified provider, and Render (static site plus a
free Node web service) instead of a Cloudflare Worker. No SDK on either side; both call `generateContent` with
`fetch`, so the project keeps its single runtime dependency. The prompt fixed the shape (pure prompt builders whose
example scripts are tested against the real parser, a pure pipeline over an injected transport with one retry,
server and bring-your-own-key transports, in-memory daily and per-IP caps, CORS, a health wake-up for Render's cold
start, mocked e2e) and asked for the exact browser-to-server JSON contract and the model id as open questions.
What Kiro did: REQ-1 to REQ-10, a design with the full JSON contract (`{kind, payload}` in, `{ok, text}` or
`{ok, error:{kind, message}}` out, eleven error kinds mapped to HTTP statuses, remaining-count headers), a Render
blueprint, and ten tasks. It chose `gemini-3.5-flash-lite` after reading Google's models, pricing and deprecation
pages, and gave the reason: `gemini-2.5-flash` is retired on December 1, 2026 and Google routes its requests to
exactly this model. It listed eighteen open questions with defaults and two things it could not verify (whether a
Render static site can read another service's hostname through `fromService`, and whether the service names are
free).
Review: I re-read Google's models, changelog and deprecations pages myself. The model id, its stable status and the
December 1 routing are all as Kiro said; the free-tier claim is not on those pages and will be settled by the first
real request. One correction from the same changelog: Google deprecated the `temperature`, `top_p` and `top_k`
sampling parameters on July 21, 2026, and the design still sends `temperature: 0.7`, so that field goes. The
unverified `fromService` lookup is replaced by the literal API hostname, since a deploy is a one-time event and a
literal cannot surprise anyone. The not-supported list in the grammar summary, the id and date rules, and the
steering boundaries all match `necrotalk.md` and the schema. Node on this machine is 24, so the `>=22.9` engine
bump for `--env-file-if-exists` costs nothing. The other sixteen defaults stand.

## 2026-11-03 — Spec 6: summon executed (tasks 1 to 9), mocked and real Playwright MCP runs
Surface: CLI (Auto)
Features: spec, steering, mcp
What I asked for: Tasks 1 to 5, stop; Task 6 up to the server check, where I ran `server:dev` myself without a key
and then with one, and pasted the results; Tasks 7 and 8 with two README fixes; then Task 9 (mocked e2e and a mocked
MCP run) plus one extra real summon through the Vite proxy with no mock.
What Kiro did: `src/summon/` (contract, prompts and grammar summary, a fetch-only Gemini client, extraction,
integrity checks, the pipeline with one retry, server and direct transports, the wake-up, the real `AgentClient`),
`server/` (a `node:http` handler tested without sockets, in-memory caps, CORS, a separate `tsconfig.server.json`),
`render.yaml`, `.env.example`, and the Summon and Settings dialogs. 855 Vitest tests in 59 files and 11 e2e tests,
with typecheck, lint, both builds and e2e green; `src/interp`, `src/model` and the fixtures untouched. My server
check: 503 `not_configured` without a key, then a real explain in 819 ms, which confirmed `gemini-3.5-flash-lite`
on the free tier. Task 8 broke six existing e2e tests: the new health request on page load went through the Vite
proxy to a port with nothing behind it and logged console errors. Kiro added one shared Playwright fixture that
mocks an unconfigured server for every spec rather than relaxing the console checks.
MCP, mocked: routes installed with `browser_run_code_unsafe` before navigating; Summon, first example, Summon;
the canned "Ghost Quiz" loaded in Edit mode, card 1 of 2, named in the picker, one `/api/summon` request, no
console errors or warnings. Screenshot `.playwright-mcp/summon-loaded.png`.
MCP, real: routes removed, health returned the real server (ok, 100 left). The first example prompt produced
"Haunted Quiz" from Gemini in 4.6 s (resource timing of the single `/api/summon` call), with no retry: the first
reply passed the schema, integrity and parse checks. It loaded in Edit mode on card Q1 of 3 (two questions and a
Results card, a Score field showing 0). In Browse, clicking "A) Salt" went to Q2 with no dialog or error. Console:
only Vite's two debug lines, no errors or warnings. Screenshots `.playwright-mcp/summon-real.png` and
`summon-real-browse.png`. Kiro also reported its own slip: it sent the Summon click and the example click in one
batch, against the one-action-per-call rule; the timestamps showed they ran in order and a state check confirmed
the prompt before it went on.
What changed: The summoned stack is valid but thin as a quiz: the Score field is a card object on Q1, so it does not
appear on Q2. That is a prompt-quality matter (the system instruction could say that shared fields such as a score
belong on the background), not a pipeline bug, and is left for review.
The flaky e2e run Kiro had reported after Task 8 came back during the final check, about one run in two. It was not
the Vite dependency reload it first guessed: it piped the web server's output, saw no reload, and read the failure
snapshot instead (the quiz on screen after the test had seen "Untitled"). The cause was a race in `src/main.ts`
older than Summon: the first fixture is a dynamic import, and a New Stack or Summon that landed before it resolved
was overwritten by the quiz a moment later. The heavier page load made the window wider. Kiro fixed it in the app
(every load bumps a counter, and a fixture import that finishes after a newer load is dropped) and made the e2e
tests wait for the first card rather than only `data-busy`; eight runs in a row, each after `npm test`, then passed.

## 2026-11-03 — Spec 6 closed: prompt rule, Task 10, review notes
Surface: CLI (Auto)
Features: spec, steering, mcp
What I asked for: after Kiro's own entry above, one prompt-quality change it had proposed but not made (objects that
must appear on every card are background objects, with an example of a card button updating a background field),
then Task 10, the final verification.
What Kiro did: added the rule and the example to the system instruction, and checked against objectOps.ts that a
card button can really address a background field at run time before relying on it in the prompt; the existing
prompt tests cover the example because they validate and parse it. Task 10 passed: no eval, innerHTML or AI SDK in
the new code, no src/summon import of src/ui, no key in any URL, every new file under 300 lines, .env ignored and
untracked. It declined to spend another request proving the new rule improves output, and said so.
What changed: My own checks matched Kiro's report (855 unit tests, 11 e2e, typecheck clean, protected directories
untouched, package.json changed only in scripts and the engine floor). Two things Kiro flagged on its own and did not
do until asked, the prompt rule and a README line outside its task, are the restraint the steering asks for. The
three MCP screenshots are copied to docs/screenshots/. Open for later specs: the round rect bevel corner artifact
and the selection outline (retro-skin), the "Status: scaffolding" README line (final pass), and the Render
deployment itself (after sharing, when the blueprint is final).

## 2026-11-03 — Spec 7: sharing (requirements, design, tasks)
Surface: CLI (Auto)
Features: spec, steering
What I asked for: a `sharing` spec from BRIEF section 7 with one override decided first: no server blob store,
because Render's free plan has no persistent storage (no disk, a non-persistent Key Value instance, a Postgres that
expires inside the demo window), so a share link backed by the server would die when the service sleeps. Sharing is
the whole stack deflated and base64url-encoded in the URL fragment, autosave to localStorage, and export/import of
`.necrocard.json`; `src/share/` imports only `src/model/`.
What Kiro did: REQ-1 to REQ-7 and seven tasks, with the override written into BRIEF §7 and product.md. It chose
`deflate-raw` for the shortest output, a base64url guard before `atob` so a tampered link fails with a plain message
instead of a DOMException, a four-way load order (share fragment, `?stack=`, autosave, default), and small hooks
(`onChange` on the editor, `currentStack` on the runtime) so `src/main.ts` feeds the live working copy to the
autosave. It raised ten open questions and flagged the one with a real trade-off itself: saving after every Browse
dispatch would make a reload resume a quiz mid-play.
Review: three changes. Autosave records what the person did, not what scripts did: Edit-mode commits, the message
box, typing into an unlocked field, and loads, but not button-script dispatches, so a reload of the quiz starts it
fresh. Opening someone else's share link must not overwrite the visitor's own autosaved stack, so a shared stack is
not saved until the visitor edits it. And two implementation notes from reading the codec design: the stream
writer's write and close promises need catch handlers or a bad link produces an unhandled rejection that Vitest
counts as a failure, and the binary-string step before `btoa` must be chunked because spreading a large byte array
into `String.fromCharCode` overflows the call stack on image-bearing stacks. The other defaults stand.

## 2026-11-03 — Spec 7: sharing executed (tasks 1 to 6), with a same-document share-link bug found by e2e
Surface: CLI (Auto)
Features: spec, mcp
What I asked for: the gate on autosave first (card navigation in Edit mode must not autosave), then Tasks 1 to 6,
with the dev server up and the real API behind the proxy so the page load has a clean console.
What Kiro did: the codec, autosave, export/import, the Share dialog, and the `src/main.ts` wiring; `EditController`
gained an `onChange` driven by a history revision counter so only real content changes autosave, not next/prev. 909
Vitest tests in 64 files and 14 e2e tests, with typecheck, lint, both builds and e2e all green and stable over three
reruns. `src/interp`, `src/model`, `src/summon` and `server/` are untouched.
The e2e found a real app bug the unit tests could not. Opening a share link on a tab that is already at the same
path is a same-document navigation — only the fragment changes — so `boot()` never re-runs and the stack never
loads or clears. Kiro first blamed the test, then reproduced both cases through the MCP browser (empty storage: the
fragment cleared; a seeded autosave reached via a second same-path navigation: it did not), read the live
`location.hash`, and saw the page had not reloaded. The fix is a `hashchange` listener in `main.ts` that opens a
share fragment that appears on an already-open page; a fresh tab still uses the initial load. The share e2e opens
the link through `about:blank` first so it is a full load, matching how a real person opens a link in a new tab.
Two assertions were also wrong against real behaviour, which the MCP run exposed: a button's accessible name on the
card is its label, not its object name (so the autosave test sets the label), and reading a Playwright download
needs `download.path()` plus a dynamic `fs` import because the repo has no Node Buffer typings.
MCP run: opened the quiz, Shared, saw a 1348-character link with the long-link warning hidden, Copy reported "Link
copied.", opened the link in a second tab where it loaded in Browse on the Title card with the fragment already
cleared and the picker showing "The Haunted Quiz", screenshot `.playwright-mcp/share-opened.png`, no console errors
or warnings.
What changed: the same-document case is worth remembering for any future fragment- or query-driven load — a SPA that
only reads the URL in `boot()` silently ignores an in-tab link paste. The autosave gate uses the history revision,
which is the one signal that already separates content edits from navigation.

## 2026-11-03 — Spec 7 closed: review notes
Surface: CLI (Auto)
Features: spec, mcp, pbt
What I asked for: after Kiro's own entry above, the autosave gate (card navigation in Edit mode must not count as
a change), Task 6 with both servers up so the page load had a clean console, and Task 7.
What Kiro did: a revision counter on the undo history that moves only when a command is applied, undone or redone,
so the editor's change signal fires for content and not for navigation, with a test that counts calls through add,
same-place move, real move, next, prev and undo. The same-document share-link bug, the two corrected test
assumptions and the MCP run are in the entry above.
What changed: My checks matched: 909 unit tests in 64 files, 14 e2e tests, both stable on rerun, protected
directories untouched, no new dependency. The screenshot also confirms the round rect button fix made between the
specs: a 1 px outline with a 2 px right and bottom shadow and clean corners, in place of the bevel whose white and
black edges met in a visible seam. Kiro's note for later stands: any future URL-driven load must handle in-tab
changes, not only the initial boot. Screenshot copied to docs/screenshots/share-opened.png.

## 2026-11-04 — Spec 8: retro-skin (requirements, design, tasks)
Surface: CLI (Auto)
Features: spec, steering
What I asked for: the visual pass from BRIEF section 8 and retro-ui.md: three open-licensed bitmap-style fonts with
the license files committed, the classic 8x8 dither set in one shared module, a 1-bit card surface, a HyperCard
window frame, a System 6 gray chrome, the inflated selection outline, the README status line, a CSS guard test and
an MCP run. The prompt named candidate families from Google Fonts because their licenses are verifiable from the
google/fonts repository rather than from a font site's "free for personal use" badge.
What Kiro did: chose Silkscreen (UI), DotGothic16 (field text) and VT323 (script), all SIL OFL 1.1, and verified
them against the repository's METADATA files because the Google Fonts site is client-rendered. It listed the four
rejected candidates with reasons, proposed internal family aliases so no third-party name reaches the DOM, noted
that BAYER_8 was already shared by the dissolve and the image dither so the move is a relocation only, and asked
before using a gradient for the title-bar stripes because the steering forbids gradients on the card.
Review: I re-verified all three licenses at the source: each sits under ofl/ in google/fonts with an OFL.txt naming
SIL Open Font License 1.1 and the designers Kiro gave. Three corrections, all about native pixel size: DotGothic16
is drawn on a 16-pixel grid, so field text runs at 16 px, not the 12 px in the design; Silkscreen at 8 px is for card
buttons (the card's 2x scale makes it legible) and titles, not chrome body text, which uses DotGothic16 at 16 px;
and DotGothic16 ships as its Latin subset, since the full file covers Japanese and weighs over a megabyte. A human
look in Chrome is scheduled after the chrome restyle and before the e2e, as with the script editor, because font
rendering is exactly what happy-dom cannot see.

## 2026-11-04 — Spec 8: retro-skin executed (tasks 1 to 8), with a human check between tasks 4 and 5
Surface: CLI (Auto)
Features: spec, steering, MCP (Playwright), hooks
What I asked for: Tasks 1-4 first (patterns, fonts, card restyle, window frame, chrome), then a stop for a human look
in Chrome. After it passed: Tasks 5-8 with additions. The selection outline inflated by 2 px, a README status line and
a Fonts note, a real-Chromium e2e for the script editor's font metrics, an MCP run against the dev server with five
named screenshots, and the six standard checks with a clean diff outside the UI.
What Kiro did: shipped the three OFL fonts as woff2 with FONTS.md and the license files, seven dither tiles pinned by
tests to one generator, a CSS guard test that fails on gradients, shadows, opacity, filters, transitions, system
fonts, non-black/white colours or non-pixel sizes inside the card surface, and the window frame in CardStage. Along the
way it caught its own mistakes:
- The first fixture-fit measurement was vacuous. An all:unset box-sizing quirk and hidden answers at 0x0 made every
  field "fit". It redone it by collapsing the height and measuring scrollHeight. Every fixture field fits at 16/20 px.
- PowerShell 5.1 stripped the double quotes from node -e, so a scripted check silently tested the wrong thing. Kiro
  moved to a temp .cjs file and deleted it.
- It took the existing dither-50.svg reference for a dangling one and generated a dither.css before finding the file.
  The CSS was replaced by the seven SVG files.
- The 2x reference came out 1028x712 against a 1027x711 window. The size mismatch exposed half-pixel centring from an
  even viewport; the e2e now uses 1441x901. The 2x threshold was measured at 824 px, then 812 px after trimming the
  viewport and status-line padding.
- A <select> matched :read-only and took the wrong style. The card menu's down-arrow is outside the fonts' Latin range,
  so it became a CSS caret in an aria-hidden span, with textContent unchanged.
- Making the scrolling-field screenshot showed a real bug: the card is built in a detached tree, so the first scroll
  bar update saw no overflow and the track and thumb stayed off until the first scroll. attachScrollBar now observes
  the content with a ResizeObserver.
- Final verification found two sharing defects. A real F5 after an edit lost the edit, because loadKey had written
  ?stack=quiz into the URL and that outranks the autosave. And typing into an unlocked field in Browse was never
  autosaved, though the sharing spec required it. Both fixed in main.ts and domHost.ts only (src/share untouched),
  each with a regression test; a mutation check confirmed the Browse-typing test fails without the hook.
Review: the "vanished" scrolling field on my first reload during the MCP run was not a rendering issue; it was the
reload bug above, which the earlier sharing e2e missed because it only navigated to a bare /. Lesson: a reload test
has to start from the URL the app itself wrote. Results: typecheck, lint, test, build, server:build and e2e all exit 0;
972 unit tests in 67 files, 23 e2e tests, stable over two extra e2e reruns. src/interp, src/model, fixtures,
src/summon, src/share and server/ are unchanged apart from the two fixes noted, package.json dependencies are
unchanged, and no proprietary typeface name appears under src/. main.ts and three CSS files now run past the 300-line
guideline from this spec's additions. The subpixel fringes and the title-bar height band were left as instructed.
The one MCP console error, 502 on /api/health, is expected because only the dev server was running.

## 2026-11-04 — Spec 8 closed: human check and review notes
Surface: CLI (Auto); the human check in Chrome on a 150 % display
Features: spec, mcp
What the human check covered, after Tasks 1 to 4: four screens in real Chrome, where the card rendered at 3x (the
window was wide enough). Title card, Q1 in Browse, Edit mode with the inspector open, and a selected button with its
three-line script. The editor region was cropped and enlarged 4x to look for the ghosting that a mirror and textarea
mismatch produces under a new font; there was none, and the gutter numbers sat on their rows. The dashed selection
outline was visibly hiding under the rect button's border, which Task 5 then fixed. Two things were waved through on
purpose: Silkscreen has no lowercase, so card button labels render as capitals, and the chrome at 16 CSS px looks
small beside a 3x card, as HyperCard's own menus did.
What the review added to Tasks 5 to 8: a real-Chromium e2e that compares the textarea's and the mirror's computed
font metrics, because the happy-dom tests cannot see font fallback; a README live-site line and Fonts note; the
subpixel fringes and the 2x height band left alone, since neither showed on the human check.
One side effect found afterwards: the MCP screenshot run added a scrolling field to the quiz title card to show the
scroll bar, and the new autosave-on-edit kept it, so the browser Playwright had opened still showed that field a
reload later. Lesson for later MCP runs: an action that edits a stack ends by reopening the fixture from the picker
(or clearing `necrocard.autosave`), so a human look does not inherit test data.
Independent checks: the three font licenses were read at source in google/fonts (OFL 1.1, no Reserved Font Name
declared); typecheck, lint, 972 unit tests, build and server:build rerun green here; the six protected areas and
package.json dependencies unchanged; no proprietary typeface name under src/. Spec 8 closes the eight planned specs.

## 2026-11-04 — Two fixes between specs: summon id repair and the picker's "your copy" label
Surface: CLI (Auto)
Features: pbt, vibe (no spec; two prompts written from a real failure and a real screenshot)
What happened: the first real Summon on the live site, "Flashcards for five Halloween words: show the word, click
to reveal the meaning, Next and Prev buttons", failed both attempts with fifty schema lines. Reproduced locally
against the same model: the stack was good (five cards, reveal button, hidden meaning, Prev/Next and a counter on the
background, every script parsed) and the only faults were ids such as `stkHalloween` and `fdWord1___`, which miss the
8 to 10 character pattern. The retry repeated them because each bad id produced ten cascading oneOf lines.
What Kiro did: `src/summon/repair.ts` rewrites any invalid or duplicate id to a stable hashed one before validation
and carries `backgroundId` references along; schema errors keep only the branch that matches the object's type; the
prompt says ids are never words. Four fast-check properties, idempotence among them, and a pipeline test that a reply
whose only faults are bad ids loads on the first request. Kiro found and fixed a leak in its own filter (a roundRect
button still drew a second line from the field branch's style list).
Review: the saved failing reply was run through the compiled new pipeline and loaded on the first attempt with the two
ids rewritten and all five cards pointing at the renamed background. 989 unit tests in 68 files, 23 e2e.
The second fix came from a screenshot: an edited sample restored from autosave appeared in the stack picker under the
same title as the pristine sample. The custom entry is now labelled "<name> (your copy)" when the name collides with
a bundled stack, with a unit test and two e2e assertions.

## 2026-11-04 — Two more fixes between specs: background buttons unclickable, selection paint in the script editor
Surface: CLI (Auto)
Features: mcp, vibe (no spec; both prompts written from a human check in Chrome)
What happened: the first summoned flashcards stack could not be navigated. Its Next and Prev buttons sit on the
background, as the Summon prompt asks, and the card-objects layer is a full-size transparent div above the
background layer, so no background object ever received a pointer event. The three bundled stacks have empty
backgrounds, which is why nothing had caught it. Kiro gave the card layer `pointer-events: none` with its children
`auto`, and added a real-Chromium e2e that loads an inline two-card stack through a share link, clicks a background
Next button and expects card 2 (commit "Fixing bg overlay bug").
The second finding was a select-all in the script editor: Chrome painted the selection bands at the wrong widths on
some rows, a long row getting a band a few characters wide and the short row after it a full-width band. My own
reproduction in headless Chromium went in circles for an hour because Playwright hides scroll bars by default, which
made variants pass or fail for the wrong reasons. Kiro's e2e launched its own Chromium with scroll bars shown and
pinned the cause in three probes: bars painted and area narrowed fails, area narrowed without bars passes, so it is
the painted scroll bars. Fix: `scrollbar-width: none` on the textarea; it still scrolls by caret, keys and wheel,
confirmed through MCP with the mirror following (169 px, then 188 px). The 20 px font size I had proposed first was
tried, measured, found not to help, and reverted exactly.
Review: Kiro declined to guess at the cause and stopped to ask when its test still failed at 20 px, which is the
behaviour the steering asks for. The pixel e2e (clip, decode through an <img> and a canvas, two sampled pixels) is a
pattern worth reusing for any paint-level check. One sharing reload e2e failed once in a full run and passed 21 of 21
on repeat; left as is and noted. Screenshot copied to docs/screenshots/script-select-all.png. 990 unit tests, 25 e2e.
Follow-up the same day: the summoned quiz's "on openCard" sat in a field's script, where card messages never arrive.
Kiro added the placement rule to the system instruction and an integrity error for openCard, closeCard, openStack
or closeStack in any object script, read from the parser's AST so a mention in a comment or string is not flagged;
a pipeline test shows the retry carrying exactly that one error and the corrected reply loading. It made one
decision on its own and said so: a mouseUp on a card is valid NecroTalk (an unhandled click passes up), so the
reverse rule is prompt guidance only, not an error. The property tests' generator now keeps card-message scripts out
of object slots. 997 unit tests.


## 2026-11-04 - Spec 9: stack-library (requirements, design, tasks, implementation)
Surface: CLI (Auto)
Features: spec, steering, MCP (Playwright)
What I asked for: a named list of the person's stacks in the picker, backed by localStorage, superseding the single
autosave: samples stay as a fixed group, every non-sample stack (New Stack, Summon, Import, share, or the first edit
of a sample) becomes a "My stacks" entry, switching is lossless, reloads reopen the last-open stack, Delete falls
back to the quiz, rename is via the inspector, and a legacy autosave migrates once. A pure module under src/share/,
picker and main.ts changes, chrome only; no server, no new deps, and src/interp, src/model, fixtures, src/summon and
server/ untouched. The spec was written requirements-first with two review rounds before any code.
What Kiro did: wrote src/share/library.ts (index key plus one body key per entry, a version field, entry ids
independent of stack.id, a numeric collision suffix, a last-open pointer that tracks samples and entries, and a
one-time legacy migration), moved chooseInitialLoad into it and removed autosave.ts. The debounce/fork/save logic
went into a unit-testable src/ui/browse/persist.ts (the reviewer's note, so main.ts would not grow unbounded and
src/share stayed model-only); the Delete button and its confirm into src/ui/browse/libraryControls.ts; the picker
became two <optgroup>s with a setEntries/select API and the old customLabel/transient-entry logic deleted. main.ts
holds an openTarget (sample or entry) and routes the three person-action signals through persist. Two review notes
were applied first: the save name re-derivation compares against a stored stackName field rather than reading the
old body, and the persist logic lives outside main.ts.
Review and what I decided: two things I caught and fixed mid-run. The import e2e assumed an imported quiz would show
"(your copy)"; it does not, because that suffix comes only from the sample fork, and a library entry named "The
Haunted Quiz" sits in "My stacks" with no collision against the sample in "Samples" — so the assertion was wrong,
not the code. And the MCP run surfaced a real bug the unit tests had missed: the Delete confirm read Delete "" because
main.ts never told the control the open entry's name; I wired setName into the picker rebuild and added an e2e
assertion that the dialog names the stack, so it cannot regress. Two files sit over the ~300-line guideline:
main.ts at 371 (it was 326 before this spec; the separable logic already moved to persist.ts and libraryControls.ts,
and the rest is cohesive top-level wiring I judged riskier to split than to leave) and library.ts at 307 (one
cohesive module). Flagged both rather than forcing a split. Results: typecheck, lint, test, build, server:build and
e2e all green; 1017 unit tests in 70 files; 27 e2e tests. The MCP run showed both picker groups, the toolbar fitting
the extra Delete button at the 2x width, and the named confirm; its only console error was the expected /api/health
502, and it cleared localStorage at the end. Screenshots in docs/screenshots/library-picker.png and
library-delete-confirm.png.

## 2026-11-04 — Spec 9 closed: what the two review rounds changed
Surface: CLI (Auto)
Features: spec
The requirements came back complete, and the review still found three conflicts that would have shipped
otherwise. The load order reopened the last library entry whenever the URL was bare, so opening a sample from the
picker and reloading would have brought back someone else's stack: the last-open pointer now tracks samples as
well as entries. Typing an answer into a quiz field counted as an edit, so every play of a sample would have forked
a "(your copy)" entry: only Edit-mode and message-box changes fork a sample now, a deliberate narrowing of the
sharing spec's save signal. And one criterion said every load writes immediately, which contradicted the rule
that an unedited sample creates nothing. The design round removed a feature: a library Rename dialog would have
given a stack a second name that drifted from the one the inspector edits and the title bar shows, so the entry
name follows stack.name and the inspector is the rename. The design also had to be told that main.ts wraps
localStorage in a wrapper that swallows errors, so a quota failure would never have reached the library.
Verification after the run: 1017 unit tests in 70 files, protected directories untouched, both screenshots
checked. Two files sit just over the 300-line guideline; left as Kiro flagged them.


## 2026-11-04 - Spec 10: edit-background (requirements, design, tasks, implementation)
Surface: CLI (Auto)
Features: spec, steering, MCP (Playwright)
What I asked for: an "Edit Background" toggle in the Card menu (Ctrl+B) that swaps which layer the editor acts on,
as HyperCard's Edit Background did, so the shared Next/Prev controls a summoned stack puts on the background become
editable; an edit to a background object shows on every card that shares it. Session state only, off after any load
and on leaving Edit, kept across cards; a chrome-only indicator (a diagonal stripe on the window title bar plus the
menu check); layer-aware commands and undo; Browse and the interpreter untouched. Changes confined to src/ui/edit/
plus a title-bar class on the stage; no change to src/interp, src/model, fixtures, src/summon, server/, src/share,
or deps. Written requirements-first with two review rounds before code.
What Kiro did: gave the editor session a layer ('card' | 'background') with setLayer/toggleLayer and a container()
helper, so selection, hit testing, Tab, the add tools, Delete, the inspector and undo all act on the active layer.
The object-targeting commands swapped their cardId for a CommandTarget ({card} | {background}), and the object
ScriptOwner the same, so applyCommand resolves and undo restores on the right layer; describeCommand suffixes
"(background)". The overlay renders the active layer's objects; the Card menu gained a menuitemcheckbox with a
CSS-drawn check and a plain-text "Ctrl+B" hint; the stage toggles a card-window-title--editing-bg class that draws a
45-degree repeating-linear-gradient stripe (chrome only). focusOn was rewritten so undo/redo never switches the
layer: it shows a card holding the object and selects it only when it is on the active layer. A fast-check property
now applies each random edit on a randomly chosen layer and still undoes/redoes byte-for-byte across all three
fixtures.
Review and what I decided: two things I handled on my own. First, I corrupted two existing test files by editing
them with PowerShell Set-Content -Encoding utf8, which added a BOM and mangled the em-dashes and ellipses; I caught
it when an unrelated image-truncation assertion failed, restored both files from git, and reapplied the edits with
the str-replace tool (which preserves encoding) — and avoided Set-Content for source files after that. Second, the
e2e first tried to select the shared button by clicking its DOM element, but in Edit mode the card layer is inert
under the overlay, so I switched to Tab-based selection and data-selected-id, which is how the editor really selects;
I also corrected the undo count once I remembered consecutive nudges coalesce into one history entry. Results:
typecheck, lint, test, build, server:build and e2e all green; 1022 unit tests in 70 files; 28 e2e tests. The MCP run
showed the diagonal-striped title bar with the new background button selected (its dashed outline and handles) and
the card's own Begin button drawn but unselected; its only console error was the expected /api/health 502, and it
cleared localStorage at the end. Screenshot in docs/screenshots/edit-background.png. One file is over the ~300-line
guideline: src/ui/edit/session.ts at 342 (it was 254 before this spec). The clean extraction — moving focusOn out —
is entangled with the session's in-place cardIndex/selection mutation and the layer-aware activeObjects, so I flagged
it for review rather than force a split I was not sure preserved behaviour.

## 2026-11-04 — Spec 10 closed: review notes
Surface: CLI (Auto)
Features: spec
Two review findings before any code. The requirements used the flashcards sample as the worked example of a shared
background, but none of the three bundled samples has a background object: their Next and Prev are card objects,
and only summoned stacks put controls on the background. Fixtures are protected, so the e2e and the MCP run now
create the background button themselves and watch it appear on the next card. And the proposed rule that undo
would switch Edit Background on to show a restored background object was reversed: undo never changes the layer,
it selects the object only when it is on the active layer, and the change is visible anyway because the inactive
layer is drawn. HyperCard's own conventions supplied the rest: Ctrl+B for the toggle and a hatched title bar as the
indicator. Verification after the run: 1022 unit tests in 70 files, protected directories untouched, the
screenshot checked. session.ts sits at 342 lines; the focusOn extraction Kiro offered is deferred, the undo
property test being the safety net if it is done later.


## 2026-11-04 - Spec 11: necrotalk-play (requirements, design, tasks, implementation)
Surface: CLI (Auto)
Features: spec, steering, MCP (Playwright)
What I asked for: one synthesized voice for NecroTalk - `play "<notes>"` and `play stop`, with an optional
`tempo <n>` prefix - so sample and summoned stacks can play short stings and jingles (a 1-bit square-wave tone,
not recorded sound). Scope is play only; item, find and send stay unimplemented. A pure notes parser in src/interp,
the host interface gains play/stopSound, domHost schedules the oscillators, the script editor and Summon learn
play, and the three samples get sound in their existing handlers. No change to src/model, server, src/share,
src/ui/edit or deps. Written requirements-first with two review rounds before code.
What Kiro did: a pure src/interp/notes.ts (parseNotes/formatNotes, NoteParseError) with sticky octave/duration,
a4=440 equal temperament, and both fast-check properties (format->parse round-trip, and every frequency a
power-of-two-twelfth of 440). Tokenizer gained play/tempo/stop; the AST, parser and printer gained a PlayStatement
(play stop / play [tempo <expr>] <expr>); the evaluator resolves the operands, parses the notes before any host
call so a bad token is a line error that plays nothing, and calls host.play/stopSound through the existing
hostCall wrapper. domHost schedules one square-wave voice per note at the beep's 0.1 gain with a 10 ms gap floored
at half the note, replaces on a new play, and silences through the gain (not a second osc.stop) with an onended
cleanup. The shared AudioContext is now created only inside the one-time pointerdown/keydown listener, which also
removed the Chrome "AudioContext was not allowed to start" warning; beep shares that gate. main.ts stops sound on
load and on entering Edit via a runtime stopSound pass-through. Summon moved play to supported with a one-line notes
grammar, an example and one prompt sentence; item/find/send stay unsupported.
Fixture play lines added (existing handlers only; the Manor got two minimal openCard handlers, no object change):
- quiz Q1 AnswerA (right): play "c e g c5"; AnswerB, AnswerC (wrong): play "e c"
- quiz Q2 AnswerB (right): play "c e g c5"; AnswerA, AnswerC (wrong): play "e c"
- quiz Q3 AnswerB (right): play "c e g c5"; AnswerA, AnswerC (wrong): play "e c"
- The Cursed Manor Entrance openCard: play "c e g e c"; Cellar openCard: play "a2 g2 e2 c2"
- Spooky Flashcards Flip (every card): play "c5s" before show field "Answer"
Review and what I decided on my own: a prior regression test used `kind: 'play'` as its stand-in for an
unimplemented node; since play is now real I repointed it to `find`. The tokenizer change forced grammar.ts's
RESERVED_WORDS to stay in sync (a test enforces equality with the tokenizer keywords), so I added the three words
there during Task 2 even though grammar.ts is nominally Task 6. The quiz has no scoring, so "right vs wrong" is just
which button advances; I put the fanfare on the known-correct answer (A zombie / October / lit jack-o-lantern, per
the existing browse e2e) and the falling pair on the others. One edit-background e2e flaked under parallel load at
its "enter Edit" step (passed 5/5 in isolation); it is a pre-existing timing race, which I hardened with a
retry-the-click `toPass` rather than leave the suite intermittently red. Results: typecheck, lint, test,
build, server:build and e2e all green; 1068 unit tests in 72 files; 29 e2e tests. The MCP run played the quiz to a
right answer and recorded four oscillators at 261.6/329.6/392.0/523.3 Hz (c e g c5); the only console message was
the expected /api/health 502 and - the point of the deferred context - no AudioContext warning; it cleared
localStorage at the end. File note: src/interp/parser.ts (1122) and evaluator.ts (658) are over the ~300 guideline
but were so long before this spec; this spec's own new file, notes.ts, is 116.

## 2026-11-04 — Spec 11 closed: review notes
Surface: CLI (Auto) / Features: spec
Two review rounds changed the design before any code. The first stopSound called osc.stop() on a voice that already
had a scheduled stop, which throws and skipped the disconnect, so a stopped melody could still finish; stop now
silences through the gain first. The shared AudioContext used to be created at module load, which Chrome warns
about before a gesture; it is now created in the one-time gesture listener, and beep shares that gate (no audible
change, since a beep always follows a click or key). Note syntax: a bare `b` is the note B and `bb` is B-flat, chosen
over treating a leading b as a flat. Verification after the run: 1068 unit tests in 72 files, 29 e2e; the fixture
diffs are exactly the play lines listed above and nothing else; no BOMs; src/model, src/share, server and
src/ui/edit untouched. parser.ts and evaluator.ts were already over the size guideline before this spec.

## 2026-11-04 — Spec 12: single-service-hosting (review of an outside draft, then the spec)
Surface: CLI (Auto)
Features: spec, steering
Provenance, stated plainly: the code for this spec was not written in this Kiro session. It arrived as an
uncommitted working-tree draft produced outside Kiro in a separate session — 13 modified files and three new ones
(server/static.ts, server/static.test.ts, server/fixtures/static/) — that folds the two-service Render layout
(static site + necrocard-api web service) into one free web service. This session reviewed that draft against the
steering, the summon spec and the brief, wrote spec 12 to document what the draft does, amended the summon spec with
superseded notes, and did one voice fix to the steering. The spec was written after the code, which is backwards
from every spec before it; it is recorded here so the write-up does not imply Kiro generated the implementation.
What the draft does: the same node:http process serves the built dist/ on every non-/api path (a pure
createStaticFiles with SPA fallback, hashed-asset immutable caching, media types and path-escape defence) and answers
/api/* with the existing Summon handler. STATIC_DIR (default dist, empty = API only) is the knob; the CORS gate now
also accepts any Origin that matches the request's own Host, so production needs no ALLOWED_ORIGINS or VITE_API_URL.
render.yaml drops to one necrocard service.
What I did: read the whole diff plus the three new files. The review verdict was sound-and-complete. The one real
nit was voice, not behaviour: the two hand-edited lines in tech.md's Hosting bullet read softer than the rest of the
terse doc ("no CORS or VITE_API_URL setup is needed in production"); I rewrote them in the doc's own voice ("One
origin, so no CORS allow-list or VITE_API_URL in production"). structure.md's inline comments already matched. Then
I wrote .kiro/specs/single-service-hosting/{requirements,design,tasks}.md in the same shape as the other specs
(Overview / In-scope / Out-of-scope / REQ-N; Module map / sections / Open questions; ordered Tasks with acceptance
checks), describing exactly what the draft implements — no new behaviour invented. I added spec 12 to BRIEF.md
section 12's spec plan.
What changed: the hosting model is now documented as a spec instead of only living in an untracked diff, and the
summon spec points forward to it rather than being silently contradicted (see the next entry). Confirmed the
server/ module boundary still holds: static.ts imports only node:fs/promises and node:path, nothing from src/.
Verification (nothing committed, pushed or deployed): the six standard checks — typecheck, lint, npm test
(1079 unit tests in 73 files), npm run build, npm run server:build, npm run e2e (29 tests) — all green. Plus the
curl smoke test against node dist-server/server/main.js with STATIC_DIR=dist and no key: /api/health -> 200
{ok:false}; / and a page route /stacks/quiz -> 200 text/html no-cache; a hashed /assets/*.js -> 200
public, max-age=31536000, immutable; /../package.json and a missing hashed asset -> 404; POST /api/summon with a
valid body -> 503 not_configured. git status -- src is clean; package.json deps and devDeps unchanged.

## 2026-11-04 — Spec 6 (summon) amended, not rewritten, for the single-service move
Surface: CLI (Auto)
Features: spec
The summon spec shipped the two-service render.yaml, so spec 12 supersedes part of it. Rather than edit history, I
left summon's requirements, design and tasks as the original record and added dated "superseded by
single-service-hosting (2026-11-04)" notes at the three places that describe the old layout: REQ-6 (build and
deployment), the design's render.yaml section, and Task 7 (dev proxy, env and blueprint). Each note names what moved
(one necrocard service serving dist/ and /api on one origin; ALLOWED_ORIGINS and VITE_API_URL gone; STATIC_DIR added)
and points at spec 12 for the shipped shape. The build, scripts, .env/.gitignore and server/ requirements in summon
are unchanged and still accurate, so those were left alone.
What changed: a reader of the summon spec now sees the two-service design it was executed against and a pointer to
why the tree no longer matches it, instead of a spec that silently disagrees with render.yaml. Verification is the
same battery as the entry above (six checks green, curl smoke test matching, e2e 29/29); these were doc-only edits,
so the numbers did not move. Nothing committed, pushed or deployed.

## 2026-11-04 — Spec 12: two corrections
Surface: CLI (Auto) / Features: spec
Fixed the date on the spec-12 work: the previous session stamped it 2026-11-05 from a UTC clock, but it was done on
2026-11-04 local time like every other entry that day, so all seven occurrences across KIRO_USAGE.md, the three
summon superseded notes and BRIEF.md section 12 now read 2026-11-04. Also corrected one sentence in the
single-service-hosting design's Request flow section that claimed a directory path without a trailing slash is 404:
a human check against the built server showed `/assets` (no slash, no extension) takes the page-route fallback and
returns index.html, while only `/assets/` (trailing slash, no index) is 404, and the paragraph now matches the code
and REQ-1.3 / REQ-1.6. No code changed.

## 2026-11-05 — README review pass (Web surface)
Surface: Web
Features: vibe (no spec; a documentation review against the repo)
What I asked for: a review of README.md as the written Kiroween submission, on the assumption judges never run the
app: a fixed section order (one-line pitch and live URL; a short "what it is"; a 60-second quick start of clone,
npm ci, npm run dev, npm test, npm run e2e; the single-service Render hosting; a "Built with Kiro" section pointing
at .kiro/ and KIRO_USAGE.md with current counts; a NecroTalk summary pointing at BRIEF section 4; the license),
every claim verified against the repo, nothing but Kiro named as a tool, stale lines removed, tone kept, under 250
lines. Then this log entry and a KIRO_USAGE edit.
What Kiro did: read the current README and KIRO_USAGE, then checked every figure against the tree rather than the
prose. Counted .kiro/: 12 specs, 5 steering docs, 3 hooks (test-on-save, typecheck-lint-before-finish,
task-done-chime), 1 custom agent (necrotalk-reviewer), one settings/mcp.json. Confirmed 73 unit test files and 9
Playwright spec files on disk, and used the totals of 1079 unit tests and 29 e2e, which were run outside this
session on this same commit (f2790a0) and reported passing. Verified render.yaml is one free web service whose
start command serves dist/ and answers /api, package.json's scripts and the Node 22.9 engine floor, and BRIEF
section 4 as the source for the NecroTalk summary (play is now implemented, so it is listed as covered). Rewrote
README to the required order at 126 lines: fixed the quick start to npm ci and added the git clone and the npm test
/ npm run e2e steps; retitled "Deploying to Render" to "Hosting" and removed the stale split-deployment line about
VITE_API_URL and ALLOWED_ORIGINS, which the single-service move retired; replaced the "the full write-up is added
before submission" placeholder with the current counts and a pointer to this log, worded "as of 2026-11-05" so it
does not imply the project is closed.
What changed because of it (time saved, bug caught, decision made): network access in this session was
repository-only — npm ci failed with a 403 from the registry (yocto-queue blocked) — so unlike the CLI sessions,
this Web session could not install packages, run the suites, or do a Playwright MCP run. The 1079/29 totals were
instead confirmed by a Vitest and Playwright run outside this session, on commit f2790a0, before the pull request
was opened. That is the main difference from the CLI work: every earlier entry cites a live test count from a run
in that same session, whereas this pass verifies the on-disk file counts directly (73 unit, 9 e2e) and relies on
the out-of-session run for the case totals. The review caught two stale statements in the README (the
split-deployment env-var sentence and the write-up placeholder) and corrected the quick start to match how a judge
would actually clone and run the repo. Scope was README.md and KIRO_USAGE.md only; no code, tests, or other files
touched, and no tool other than Kiro is named.
Update 2026-11-06: the submission text was moved out of the repo into the hackathon package folder, since it is
pasted into Devpost rather than read from GitHub; docs/SUBMISSION.md no longer exists in the repo.

## 2026-11-05 — Devpost submission draft (IDE surface)
Surface: IDE
Features: vibe (no spec; a write-up drafting task against the repo)
What I asked for: draft the Devpost submission as docs/SUBMISSION.md, on the assumption judges never run the app, so
this document and the README are the written submission. Part 1 a ~300-word project description (what NecroCard is,
who it is for, the problem, the features, the live URL, category Resurrection); Part 2 ~1000 words answering the
judges' prompts in order — surfaces, custom agents, hooks, spec-driven development, steering, MCP, property-based
testing, Kiro powers — each sourced from this log, the brief, the README, .kiro/ and the test suites, with no tool
named but Kiro and no invented facts. Then this log entry.
What Kiro did: read KIRO_USAGE.md in full, docs/BRIEF.md, README.md, the five steering docs, the three hook JSON
files, the necrotalk-reviewer agent, and .kiro/settings/mcp.json. Counted the Surface field of every entry directly
from the file: 41 dated entries, 39 CLI, 1 Web, 1 "none yet", 0 IDE, 0 Crew — so the draft states Crew was not used
and this is the first IDE entry. Confirmed no Kiro power was ever used (the word "powers" appears only in this log's
header template and in the agent's includePowers: false). Wrote docs/SUBMISSION.md with the two parts, kept a marked
"[author's own notes on IDE vs CLI]" placeholder, and used "as of 2026-11-05" rather than "final" or "last".
What changed because of it (time saved, bug caught, decision made): this IDE session differs from the CLI sessions
in the same way the Web session did — it did no spec execution, no test run, and no Playwright MCP run; it only read
the repository and wrote two documentation files. It differs from the 2026-11-05 Web session in that it had no npm
registry failure to work around and its job was authoring the submission document rather than reviewing the README.
Like the Web session, it verified claims against the repo on disk (entry counts, the three hook files, the agent
config, the MCP config, the conditional-steering fileMatch patterns) rather than from a live suite run in-session;
the 1079 unit / 29 e2e totals quoted in the README come from the out-of-session run on commit f2790a0, not from this
session. Scope was docs/SUBMISSION.md (new) and this KIRO_USAGE.md entry only; no code, tests, or other files
touched, and no tool other than Kiro is named.
Update 2026-11-06: the submission text was moved out of the repo into the hackathon package folder, since it is
pasted into Devpost rather than read from GitHub; docs/SUBMISSION.md no longer exists in the repo.

## 2026-11-06 - Curated screenshot gallery, a rule to keep it current, README hero
Surface: CLI
Features: mcp, steering
What I asked for: a reproducible set of seven 1280 by 1024 screenshots in docs/screenshots/gallery/ taken with the
Playwright MCP server against the local dev server from a clean browser profile, a gallery README with exact retake
steps, a steering rule that keeps the gallery current, and the shots wired into the README.
What Kiro did: drove the browser through Playwright MCP (browser_resize, browser_evaluate to clear localStorage,
browser_click, browser_file_upload, browser_take_screenshot) and saved 01-title through 07-share. It found that port
5173 was held by another project's dev server, so it started NecroCard's own on 5174 and documented "use the port Vite
prints". Summon worked with the local Gemini key; the generated stack was saved once as summon-stack.json and shot 05
was taken by importing that file through Share and Import, so retakes need no Gemini call. A native select's popup
cannot be photographed, so shot 06 first expanded the picker in place with temporary styles; a follow-up retook it
as real, unstyled UI instead: three own stacks made through Import and New Stack plus an inspector rename, captured
at the Delete confirmation with the closed picker showing the stack name. Kiro then widened the retro-ui.md fileMatchPattern to cover index.html and public/**, added the
"Screenshots stay current" section, added the hero and a Screenshots section to the README, and listed the visual
problems it saw in the images without fixing any.
What changed because of it (time saved, bug caught, decision made): the gallery can be rebuilt by a later session from
the README alone, and any change to what a user sees now has to name the shots it affects. Two things went wrong on the
way: a click on a card object in Edit mode times out because the card layer is inert there (a real mouse click at page
coordinates works), and a scripted double import left two stray file choosers open that had to be cleared before the
page responded. The browser image reads also showed that the message box strip at the bottom of every shot is an
unlabeled blank bar.

## 2026-11-06 - Polish pass before the video: message box hint, composed samples, (shared) names, share status
Surface: CLI
Features: steering, mcp
What I asked for: five small fixes, with a test wherever there was code: a placeholder and aria-label for the blank
message box; a composed title card for The Haunted Quiz; the stack-library collision rule (REQ-1.4) with a
" (shared)" suffix for share-link and file imports, so the picker never shows two identical names; rebalanced sample
cards that left most of the card empty, by moving and resizing existing objects only; and a one-line "Opened from a
shared link" status message. Then, per the "Screenshots stay current" rule, name the affected gallery shots and
retake them.
What Kiro did: gave the message box the hint "Type a NecroTalk command and press Enter" in the muted chrome grey,
hidden while the box is disabled, keeping the existing "Message box" aria-label (unit test). Centred the quiz title
field over a larger centred roundRect button. Added sharedName() next to forkName() in src/share/library.ts: a name
that matches a sample or an entry becomes "<name> (shared)", and the existing numeric rule handles a second
collision. main.ts applies it to share links and Import only, not to Summon or New Stack (five unit tests, two e2e
assertions). Moved and resized objects in all three samples: the quiz questions, Results and Title; every Cursed Manor
card; the flashcards Title and End cards. The flashcard question cards were already full and were left alone.
summon-stack.json was not touched. The share open path shows the status message only when the status line is empty,
so a "library full" warning is not hidden, and the next action clears it like any other status (e2e). The rule
pointed at all seven shots: the message box hint shows in every Browse shot, the samples changed 01, 02, 03, 04 and
07, and 07 also gained the status line and the "(shared)" name. All seven were retaken and viewed.
What changed because of it (time saved, bug caught, decision made): the "Screenshots stay current" rule did its job
on its first real use. The report has to name the affected shots, which showed that one CSS hint touched the whole
gallery, so all seven were retaken in one pass rather than patched. The share link change also corrected an old e2e
comment that called "no collision inside My stacks" fine: the picker showed "The Haunted Quiz" twice. A retake script
that waited for file choosers inside a Playwright code block left stray choosers open, so the gallery README now says
to use the MCP file-upload step. One first e2e run had three retro-skin failures at the Edit toggle; they did not
recur on any later run.

## 2026-11-06 - Status line info tone; the (shared) rule written into the stack-library spec
Surface: CLI
Features: spec, steering, mcp
What I asked for: draw neutral notices such as "Opened from a shared link" in a neutral style instead of the error red,
keep red for errors such as the library-full message, test both, and retake 07-share.png. Then record the " (shared)"
naming rule in the stack-library requirements and design so the spec matches sharedName.
What Kiro did: moved the status line out of main.ts into src/ui/browse/statusLine.ts. Its show() takes an optional
tone that defaults to 'error', so every existing caller keeps the red style without changes, and 'info' adds a
status-line--info class in the chrome text colour. Only the share notice passes 'info'. Four unit tests cover the share
notice (info), the quota message (error), switching back from info to error, and clear; the sharing e2e test checks
the class and the computed colour. Added one sentence to REQ-1.4 and the matching sharedName line to design section
2.4. Retook 07 per the gallery README and checked it: neutral dark text, picker "The Cursed Manor (shared)".
What changed because of it (time saved, bug caught, decision made): the "Screenshots stay current" rule limited the
retake to one shot, 07, because the info style shows only after a share link opens. Defaulting the new tone to
'error' kept the change to one call site instead of touching every status message in the editor and runtime.

## 2026-11-06 - Edit toggle flake: re-check the fix against current Playwright docs with the Context7 power
Surface: CLI
Features: power, mcp
What I asked for: an earlier session, interrupted by a restart, fixed a flake in retro-skin.spec.ts (1 failed / 99
passed with --repeat-each=20: an Edit click before the first stack loaded was dropped and the mode stayed "browse").
In that session the Context7 power's server was not connected, so the fix was checked against playwright.dev instead.
This session redid the lookups with the Context7 power, compared them with the fix, listed fixed timeouts in
test/e2e/, proved the fix, and pinned the Playwright MCP version.
What Kiro did: activated the Context7 power, confirmed both tools (resolve-library-id, query-docs) and resolved
Playwright to /websites/playwright_dev. Four lookups: (1) locator.click: it waits for actionability checks, and
"force" skips the checks and "trial" runs only the checks; (2) auto-waiting: click needs the element to be
visible, stable, receiving events and enabled; (3) web-first assertions: toBeVisible, toHaveAttribute, toHaveClass
and toBeEnabled all retry until the assertion timeout; (4) expect.poll and expect.toPass as the retrying
alternatives to a fixed wait. Comparison: the docs confirm the fix. click() already waits for "enabled", but the Edit
toggle was never disabled before the first load, so that wait passed at once and the app dropped the click. Keeping it
disabled until runtime.currentStack is set makes Playwright's own auto-wait do the job. openSample uses retrying
assertions (toHaveAttribute, toBeEnabled), no fixed waits. Nothing in the fix or helper was changed. Fixed waits
found in test/e2e/: two waitForTimeout(700) in stack-library.spec.ts (lines 25 and 130), waiting past the 500 ms save
debounce. Not changed in this task. The Context7 lookup returned expect.poll / expect.toPass as the retrying
replacements, polling for the saved state instead of sleeping; it did not return an explicit "discouraged" sentence
for waitForTimeout. Other timeout values in the folder are assertion or action timeouts (browse.spec.ts:84,
edit-background.spec.ts:39-40, script-editor.spec.ts:26/35/121), which are not fixed sleeps. Proof: retro-skin.spec.ts
with --repeat-each=20 gave 100 passed, 0 failed; npm run check clean; npm test 74 files / 1089 tests passed; npm run
e2e 30 passed. The power is installed per user, so it does not appear in the repo's .kiro/ folder. No gallery shot
changes: the toggle is disabled only before the first load, and every shot is taken after a stack is shown. The
@playwright/mcp entry in .kiro/settings/mcp.json was moved from @latest to the exact npm version 0.0.84, to be pasted
in by hand because that folder is not writable from the session.
What changed because of it (time saved, bug caught, decision made): the flake is now explained from current docs
rather than from a page fetched while the power was down, and the decision not to touch the fix is backed by them. It
also explains the "three retro-skin failures at the Edit toggle" mentioned at the end of the earlier polish-pass
entry (the one headed "Polish pass before the video"): those were this same race. A follow-up, replacing the two
fixed 700 ms waits with a retrying check, is open.

## 2026-11-07 - Replace the two fixed 700 ms waits in stack-library.spec.ts with retrying checks
Surface: CLI
Features: vibe
What I asked for: close the follow-up left open by the entry "Edit toggle flake: re-check the fix against current
Playwright docs with the Context7 power". Replace both page.waitForTimeout(700) calls (there to get past the 500 ms
save debounce) with retrying checks, in test code only, nothing under src/.
What Kiro did: read src/ui/browse/persist.ts and src/share/library.ts to see how a save lands: a 500 ms trailing
debounce, then save() writes the entry body under 'necrocard.library.entry.<id>' first and the index
('necrocard.library') second, and only a rename changes the index record's display name. In addLabelledButton the sleep
became expect.poll over a small page.evaluate helper that reads the last-opened entry's stored body and waits until it
holds a button with the new label, with a message saying what it waits for. In the rename test the window title
follows the rename at once, but the picker label is rebuilt from the index, which changes only after the debounced
save, so the existing retrying toHaveText on the picker label already waits for persistence; the sleep was simply
removed, with a comment saying why. Both waits were checked by breaking them: polling for "LanternX" failed after 5 s
with "the open library entry should be saved with a button labelled "Lantern"" (expected true, received false), and
expecting "Midnight Manor X" failed with the picker going "Untitled" then "Midnight Manor", which shows the label is
save-gated. Both breaks were reverted. Results: stack-library.spec.ts --repeat-each=20 gave 140 passed, 0 failed;
npm run check clean; npm test 74 files / 1089 tests passed; npm run e2e 30 passed; no waitForTimeout is left in
test/e2e/. Runtime: the whole file took 4.6 s before and 4.8 s after in a default parallel run (the longest test sets
the wall time, so it did not move); the edit tests that used the helper took about 2.3 to 2.8 s each before and 1.7 to
2.1 s each after in a one-worker run. The two conditions differ, so treat that as roughly 0.5 s saved per test, not a
measured benchmark. src/ is untouched.
What changed because of it (time saved, bug caught, decision made): the tests now wait for the real condition, so they
neither over-wait nor pass on a slow machine by luck; a failure names the missing label. Decision: the rename test
needed no storage poll because its existing assertion is already save-gated. This is test-only, so no gallery shot
changes and none was retaken.
