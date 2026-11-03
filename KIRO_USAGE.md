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
