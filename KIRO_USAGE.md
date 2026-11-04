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
