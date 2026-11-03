# necrotalk-interpreter — Tasks

Execute in order. Each task is independently verifiable. Do not start a task until the previous one passes its acceptance check.

---

## Task 1 — AST types and errors

Define all AST node types and the error infrastructure before writing any parsing or evaluation logic.

**Steps:**
1. Create `src/interp/ast.ts` with all type definitions from REQ-1: `ScriptNode`, `HandlerNode`, `StatementNode`
   (union of all statement types), `ExpressionNode` (union of all expression types), `ObjectRef`, `ContainerNode`,
   `GoTarget`, `RepeatVariant`, `BinaryOp`, `CountExpression`, etc. Every node has a `kind` discriminator.
   Every statement interface includes a `line: number` field.
2. Add JSDoc comments on `ScriptNode` and key union types describing the AST design.
3. Create `src/interp/errors.ts` with `NecroTalkError` class and `formatError` helper per REQ-7.
   `formatError` always appends a period; the `msg` argument must not end with a period.
4. Write a smoke test `src/interp/ast.test.ts` that imports all types and constructs a minimal `ScriptNode` to
   confirm the types compile.

**Acceptance:** `npm run typecheck` exits 0. The smoke test imports all AST types without errors. No logic yet,
just types.

---

## Task 2 — Tokenizer

Implement the tokenizer per REQ-2.

**Steps:**
1. Create `src/interp/tokenizer.ts` exporting `Token`, `TokenType`, and `tokenize(source: string): Token[]`.
2. Implement the tokenization algorithm from the design: skip whitespace (not newlines), recognize comments (`--`),
   string literals (`"`), numbers (non-negative decimals only), operators, punctuation, keywords
   (case-insensitive, stored lowercase), identifiers, newlines, EOF.
3. Throw `NecroTalkError` for unterminated strings (including strings containing raw newlines), invalid characters.
4. Write `src/interp/tokenizer.test.ts` with unit tests:
   - Tokenize a simple handler: `on mouseUp\n  beep\nend mouseUp` → correct token sequence.
   - Keywords are case-insensitive and normalized to lowercase.
   - String literal with spaces → single `string` token with quotes stripped.
   - Comment line is skipped entirely.
   - Unterminated string throws `NecroTalkError` with correct line number.
   - String literal containing `"` or `\n` throws `NecroTalkError`.
   - Invalid character throws `NecroTalkError`.
   - All operators (`<=`, `<>`, `&&`, etc.) tokenize correctly.

**Acceptance:** `npm test` passes all tokenizer tests. `npm run typecheck` exits 0.

---

## Task 3 — Parser (structure and simple statements)

Implement the parser structure and parse simple non-nested statements.

**Steps:**
1. Create `src/interp/parser.ts` with a `Parser` class (internal) and `export function parse(source: string): ScriptNode`.
2. Implement `parseScript()`, `parseHandler()`, `parseStatement()` skeleton that recognizes `beep`, `go next`,
   `go prev`, `go first`, `go last`, `show <objectRef>`, `hide <objectRef>`, `exit repeat`, `next repeat`,
   `pass <identifier>`. Parse `show` and `hide` as `show field "Name"`, `show button "OK"`, `show me`, etc.
   using `parseObjectRef()`.
3. Implement expression parsing for literals only (numbers, strings, `true`, `false`) and identifiers (variables).
   No binary operators yet.
4. Implement `parseObjectRef()` for `field "<name>"`, `button "<name>"`, `card`, `background`, `stack`, `me`, etc.
5. Implement `parseContainer()` for `field <objectRef>`, `<identifier>`, and `it`.
6. Add `put <expr> into <container>` and `get <expr>` parsing.
7. All parsed statement nodes must include the correct `line` number from the token position.
8. Write `src/interp/parser.test.ts` with tests:
   - Parse a minimal handler with `beep`.
   - Parse `go next`, `go prev`, `go first`, `go last`.
   - Parse `put "hello" into it`.
   - Parse `show field "Name"`, `hide button "OK"`, `show me`.
   - Parse `exit repeat`, `next repeat`, `pass mouseUp`.
   - Parse error cases: missing `end`, unexpected EOF inside handler, unknown command.
   - Verify `line` fields on parsed statements match source line numbers.

**Acceptance:** `npm test` passes parser tests for simple statements. No control flow or complex expressions yet.

---

## Task 4 — Parser (control flow)

Add parsing for `if`, `repeat`, and `exit <handler>`.

**Steps:**
1. Implement `if <expr> then <stmt>` (single-line) and `if <expr> then\n...\nend if` (multi-line) with optional
   `else` branch.
2. Implement `else if <cond> then ...` as syntactic sugar: parse it as a nested `IfStatement` in `elseBranch`
   (not a new AST node). A single `end if` terminates the outermost `if`.
3. Implement `repeat <N> times`, `repeat with <var> = <a> to <b>`, `repeat while <expr>`.
4. Implement `exit <handlerName>`.
5. All parsed statement nodes must include the correct `line` number.
6. Add tests:
   - Parse single-line `if` with then clause only.
   - Parse multi-line `if` with `else`.
   - Parse `else if` sugar — verify the AST is a nested `IfStatement` in `elseBranch`.
   - Parse nested `if` inside `repeat`.
   - Parse all three `repeat` variants.
   - Parse `exit mouseUp`.
   - Error: `if` without `end if`, `repeat` without `end repeat`.

**Acceptance:** `npm test` passes control flow parsing tests.

---

## Task 5 — Parser (expressions and binary operators)

Implement full expression parsing with precedence.

**Steps:**
1. Implement precedence climbing or Pratt parser for binary operators per the design's precedence table.
2. Implement unary `-` and `not`.
3. Implement function calls: `random(N)`, `length(s)`, etc. — parse as `FunctionCallExpression`.
4. Implement property expressions: `the date`, `the time`, `the <property> of <objectRef>`.
5. Implement chunk expressions: `word <N> of <expr>`, `line <N> of <expr>`, `char <N> of <expr>`.
6. Implement `CountExpression`: `the number of cards`, `the number of words of <expr>`,
   `the number of lines of <expr>`, `the number of chars of <expr>`.
7. Identifiers used as variable names are stored lowercased in `VariableExpression`.
8. Add tests:
   - Parse `1 + 2 * 3` → correct precedence AST (2*3 is right child of +).
   - Parse `"a" & "b" && "c"` → correct precedence.
   - Parse `x = 5 or y > 10` → correct precedence.
   - Parse `not (a and b)` → unary op with parentheses.
   - Parse `random(100)`.
   - Parse `the date`.
   - Parse `word 1 of "hello world"`.
   - Parse `the number of cards` → `CountExpression { what: 'cards' }`.
   - Parse `the number of words of myText` → `CountExpression { what: 'words', source: ... }`.

**Acceptance:** `npm test` passes expression parsing tests. All operators and precedence levels work.

---

## Task 6 — Parser (remaining statements)

Add parsing for the remaining statements not covered in Task 3–4.

**Steps:**
1. Implement `go to card <N>`, `go to card "<Name>"`.
2. Implement `visual effect dissolve | wipe left | wipe right | scroll up`.
3. Implement `put <expr> before <container>`, `put <expr> after <container>`.
4. Implement `set <property> of <objectRef> to <expr>`.
5. Implement `global <varName>`.
6. Implement `answer <expr> [with <btn1> [or <btn2> [or <btn3>]]]`. When no `with` clause, emit `buttons: ["OK"]`.
7. Implement `ask <expr> [with <default>]`.
8. Add tests for each, including `answer` without `with` defaulting to `buttons: ["OK"]`.

**Acceptance:** `npm test` passes all statement parsing tests. The parser can now parse any valid NecroTalk script
from the frozen grammar.

---

## Task 7 — AST printer

Implement the AST printer per REQ-4.

**Steps:**
1. Add `export function print(script: ScriptNode): string` to `parser.ts` (or extract to `printer.ts` if preferred).
2. Implement the design's recursive printer: walk the AST, emit NecroTalk source, indent nested blocks.
3. Implement correct parenthesization: parenthesize a child `BinaryExpression` when its precedence is lower than
   the parent operator's, or equal precedence on the right side of a left-associative operator (per REQ-4.3).
   Use a `needsParens(child, parentOp, side)` helper.
4. Handle `else if` sugar in the printer: when `elseBranch` contains a single `IfStatement`, emit `else if ...`
   instead of `else\n  if ...`.
5. Add unit tests in `parser.test.ts`:
   - Print a simple handler with `beep` → valid NecroTalk.
   - Print a handler with `if` and `repeat` → correct indentation and structure.
   - Print `else if` sugar → emitted as `else if ...` not nested `else\n  if`.
   - Parenthesization: `(a + b) * c` printed correctly (addition parenthesized inside multiply).
   - Parenthesization: `a - (b - c)` printed correctly (right subtraction parenthesized).
   - Parse, print, parse again → ASTs are deep-equal after `stripPositions()` (manual test with a few examples).
6. Implement `export function stripPositions(ast: ScriptNode): ScriptNode` — returns a deep copy with `line: 0`
   on every statement node. Export this helper for use in PBTs.

**Acceptance:** `npm test` passes printer tests. Printed output is valid NecroTalk that parses to the same AST
structure. Parenthesization tests pass.

---

## Task 8 — PBT: parse → print → parse round-trip

Property-based test for the printer using fast-check.

**Steps:**
1. In `parser.test.ts`, create fast-check arbitraries for `ScriptNode` AST. Apply these constraints:
   - String literal values: exclude `"` (double-quote), `\n`, `\r` — use a filtered `fc.string` or a character
     set that excludes these. NecroTalk has no escape sequences.
   - Number literals: non-negative finite decimals only. Use `fc.nat()` or `fc.float({ min: 0, noNaN: true, noDefaultInfinity: true })`.
   - Identifiers (variable names, handler names, parameter names): must match `[A-Za-z_][A-Za-z0-9_]*` and must
     NOT be NecroTalk keywords. Build a `KEYWORDS` set and filter generated strings with `fc.filter`.
2. Generate handlers with:
   - Various statement types (go, put, if, repeat, beep, etc.).
   - Nested control flow (if inside repeat, repeat inside if).
   - All expression types (literals, variables, binary ops, function calls, chunks, CountExpression).
   - Unicode strings in string literals (excluding `"`, `\n`, `\r`).
   - Handler parameters (0 to 3 params).
3. Set `line: 0` on all generated statement nodes (since the printer always produces line 0-free ASTs anyway).
4. Write the PBT:
   ```ts
   fc.assert(fc.property(scriptArb, script => {
     const printed = print(script);
     const reparsed = parse(printed);
     expect(stripPositions(reparsed)).toEqual(stripPositions(script));
   }), { numRuns: 200 })
   ```

**Acceptance:** `npm test` runs the PBT with 200 examples, all pass. If fast-check finds a counter-example, fix
the printer or parser (do not reduce `numRuns`).

---

## Task 9 — Host interface and evaluator skeleton

Define the host interface and evaluator entry point before implementing statement execution.

**Steps:**
1. Create `src/interp/evaluator.ts` exporting `HostInterface` (per REQ-5.1) and
   `evaluate(script, handlerName, args, host, globals): Promise<void>`.
   Async host methods: `goToCard(index: number): Promise<void>`, `setVisualEffect(...): Promise<void>`,
   `answer(...): Promise<string>`, `ask(...): Promise<string>`. All other host methods synchronous.
2. Implement the evaluator skeleton: find the handler (case-insensitive), set up local scope with params
   (lowercased keys), call `executeStatement` on each statement. Catch `ExitHandlerException`.
3. Implement `executeStatement` as an async switch on `stmt.kind` with stubs for each statement (e.g., `beep`
   calls `host.beep()`, `go` calls `host.goToCard()` — stub with correct async call). Thread the execution
   budget `{ count: number }` object through all recursive calls.
4. Implement `evaluateExpression` for literals and variables only (no binary ops yet). Unset variable evaluates
   to its own lowercased name.
5. Write `src/interp/evaluator.test.ts` with a `MockHost` class implementing `HostInterface` (async methods
   return resolved promises). Test:
   - Evaluate a handler with `beep` → `MockHost.beep()` was called.
   - Evaluate a handler not found → resolves silently.
   - Evaluate `get 42` → `it` local is set to `"42"`.
   - Case-insensitive handler lookup: `evaluate(..., "MOUSEUP", ...)` finds handler named `mouseUp`.

**Acceptance:** `npm test` passes evaluator skeleton tests. No control flow or complex expressions yet.

---

## Task 9a — Navigation module

Implement `resolveNavigation` per REQ-11.

**Steps:**
1. Create `src/interp/navigation.ts` exporting
   `resolveNavigation(target: GoTarget, currentIndex: number, cardCount: number, cardNames: string[]): number`.
2. Implement all target types:
   - `next`: `(currentIndex + 1) % cardCount`.
   - `prev`: `(currentIndex - 1 + cardCount) % cardCount`.
   - `first`: `0`.
   - `last`: `cardCount - 1`.
   - `card <N>` (number, 1-based): throw `NecroTalkError` if `N < 1` or `N > cardCount`.
   - `card <name>` (string): case-insensitive search; throw `NecroTalkError` if not found.
3. Error messages end with a period (use `formatError`). The caller passes the `GoStatement.line` value.
4. Write `src/interp/navigation.test.ts`:
   - `next` on last card wraps to 0.
   - `prev` on first card wraps to `cardCount - 1`.
   - `first` and `last` return correct indices.
   - Numeric card index 1-based: `card 1` → 0, `card 5` → 4 (5-card stack).
   - Out-of-range numeric index throws `NecroTalkError`.
   - Named card found case-insensitively.
   - Named card not found throws `NecroTalkError`.
5. Update the evaluator stub for `go` to call `resolveNavigation` and then `await host.goToCard(resolvedIndex)`.

**Acceptance:** `npm test` passes navigation tests. `resolveNavigation` has no host dependency.

---

## Task 10 — Evaluator (control flow)

Implement control flow statement execution: `if`, `repeat`, `exit`, `pass`.

**Steps:**
1. Implement `if` execution: evaluate condition (coerce to boolean), execute thenBranch or elseBranch.
2. Implement `repeat times`, `repeat with`, `repeat while` as JavaScript `async` loops. Catch `ExitRepeatException` and
   `NextRepeatException`. Each loop iteration calls `await executeStatement(...)` for body statements.
3. Implement `exit <handler>`: throw `ExitHandlerException`.
4. Implement `exit repeat`: throw `ExitRepeatException`.
5. Implement `next repeat`: throw `NextRepeatException`.
6. Implement `pass <handler>`: throw `PassException` (will move to `messageQueue.ts` in Task 13).
7. Add tests (using `await evaluate(...)` in all test assertions):
   - `if true then beep` → beep called.
   - `if false then beep` → beep not called.
   - `if`/`else if` sugar executes the correct branch.
   - `repeat 3 times` → loop body executed 3 times.
   - `repeat with i = 1 to 5` → loop variable increments correctly (verify lowercased key).
   - `repeat while <condition>` → loop exits when condition becomes false.
   - `exit repeat` breaks out of loop.
   - `next repeat` skips to next iteration.
   - `exit mouseUp` throws `ExitHandlerException`.

**Acceptance:** `npm test` passes control flow execution tests.

---

## Task 11 — Evaluator (expressions and operators)

Implement full expression evaluation including all binary operators, unary operators, and built-in functions.

**Steps:**
1. Implement `evaluateBinaryOp(op, left, right, currentLine)` helper covering:
   - Arithmetic: coerce to numbers (throw `NecroTalkError` at `currentLine` if coercion fails), compute, return string.
   - Comparison: numeric if both parse as numbers, else string comparison.
   - Logic: coerce to boolean (`""` and `"0"` and `"false"` are falsy, else truthy), compute, return `"true"` or `"false"`.
   - Concatenation: `&` (no space), `&&` (with space).
2. Implement unary `-` and `not`.
3. Implement `FunctionCallExpression` evaluation: `random(N)` calls `host.random(N)`, `length(s)` returns string
   length, etc.
4. Implement `PropertyExpression` evaluation: `the date` calls `host.getDate()`, `the <property> of <objectRef>`
   calls `host.getProperty(ref, property)`.
5. Implement `CountExpression` evaluation: `what: 'cards'` calls `host.getCardCount()`; `what: 'words'/'lines'/'chars'`
   evaluates source expression and counts.
6. Implement `ChunkExpression` evaluation: split source string, index (1-based), return chunk or `""` if out of range.
7. Unset variable: if variable key not in locals, not declared global, not in globals, return the key itself.
8. Add tests:
   - `1 + 2 * 3` → `"7"`.
   - `"a" & "b"` → `"ab"`.
   - `"a" && "b"` → `"a b"`.
   - `5 > 3` → `"true"`.
   - `"abc" contains "b"` → `"true"`.
   - `not true` → `"false"`.
   - `random(10)` returns a string in `["1", "2", ..., "10"]` (mock returns fixed value for test).
   - `word 2 of "hello world"` → `"world"`.
   - `char 3 of "abc"` → `"c"`.
   - Arithmetic on `"abc"` throws `NecroTalkError`.
   - Unset variable `foo` evaluates to `"foo"`.
   - `the number of cards` calls `host.getCardCount()`.
   - `the number of words of "a b c"` → `"3"`.

**Acceptance:** `npm test` passes expression evaluation tests.

---

## Task 12 — Evaluator (remaining statements and host calls)

Implement the remaining statement execution logic not covered in Tasks 9–11.

**Steps:**
1. Implement `go` statement execution: call `resolveNavigation(target, currentIndex, cardCount, cardNames)` where
   `currentIndex`, `cardCount`, and `cardNames` come from `host.getCurrentCardIndex()`, `host.getCardCount()`,
   and `host.getCardNames()`. Then `await host.goToCard(resolvedIndex)`.
2. Implement `visual effect`: `await host.setVisualEffect(...)`.
3. Implement `put` statement: evaluate expression, update container (local, global, or `host.setFieldText(ref, text)`).
4. Implement `set` statement: call `host.setProperty(ref, property, value)`.
5. Implement `global` statement: add `varName.toLowerCase()` to `globalDecls`; if already in locals, move the
   value to globals.
6. Implement `answer` and `ask`: `await host.answer(...)` / `await host.ask(...)`, store result in `it`.
7. Implement `show` and `hide`: call `host.showObject(ref)` / `host.hideObject(ref)`.
8. Add tests for each, using `MockHost` (with async methods returning resolved promises) to verify calls.
9. Add execution budget test: a script with `repeat while true\n  beep\nend repeat` must throw `NecroTalkError`
   with message matching `"Script ran too long."` before the test times out.

**Acceptance:** `npm test` passes all statement execution tests including the budget test. The evaluator can now
execute any valid NecroTalk script from the frozen grammar.

---

## Task 13 — Message queue and pass handling

Implement message dispatch with the pass mechanism per REQ-6.

**Steps:**
1. Move `PassException` from `evaluator.ts` to a new `src/interp/messageQueue.ts` file.
2. Implement `dispatchMessage(message, args, context, host, globals): Promise<void>` per the design: try each
   script in order (object, card, background, stack), catch `PassException` to continue the chain.
3. Cache parsed scripts: use a local `Map<string, ScriptNode>` — parse each source string at most once per
   `dispatchMessage` call.
4. Write `src/interp/messageQueue.test.ts`:
   - Dispatch a message found in object script → handler runs, stops (all async).
   - Dispatch a message found in card script (not in object) → handler runs.
   - Handler in object calls `pass` → continues to card script.
   - Handler not found anywhere → resolves silently.
   - Handler throws error → error propagates.
   - Same source string not parsed twice (verify parse cache by wrapping `parse` with a spy).

**Acceptance:** `npm test` passes message dispatch tests.

---

## Task 14 — PBT: put/read invariant

Property-based test for the `put`/read round-trip per REQ-8.2.

**Steps:**
1. In `evaluator.test.ts`, create a fast-check arbitrary for string values using a character set that excludes
   `"`, `\n`, and `\r` (e.g., `fc.string({ unit: 'grapheme' }).filter(s => !/["\\n\\r]/.test(s))`).
2. For each generated value, construct a script: `on test\n  put "<value>" into it\nend test`, parse it, evaluate
   it with a `MockHost` (using `await evaluate(...)`), then read `it` from the evaluator's local scope (expose
   via a `get it` statement or a test helper).
3. Assert the read value equals the original.
4. Run 200 examples.

**Acceptance:** `npm test` runs the PBT with 200 examples, all pass.

---

## Task 15 — PBT: navigation range invariant

Property-based test for navigation per REQ-8.3.

**Steps:**
1. In `navigation.test.ts`, write a PBT for `resolveNavigation` directly:
   - 5-card stack with names `["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]`.
   - Generate sequences of `GoTarget` values: `next`, `prev`, `first`, `last`, and `card <N>` where `<N>` is 1–5.
   - Simulate navigation by calling `resolveNavigation` in sequence, updating the current index each step.
   - Assert `resolveNavigation` always returns a value in `[0, 4]`.
   - Run 200 examples with sequences of 1 to 20 targets.
2. Also write a thin evaluator integration test using `MockHost`: parse and evaluate `go next` / `go first` / etc.,
   verify `MockHost.goToCard` was called with the correct 0-based index.

**Acceptance:** `npm test` runs the PBT with 200 examples, all pass. Navigation never leaves the valid range.

---

## Task 16 — Integration tests

Write a few end-to-end integration tests that parse, evaluate, and verify behavior.

**Steps:**
1. In `evaluator.test.ts` (or a new `integration.test.ts`), write tests that parse a multi-line script, evaluate
   a handler with `await evaluate(...)`, and verify the `MockHost` received the expected calls in the correct order.
2. Examples:
   - A script with a counter loop that increments a variable and puts it into a field.
   - A script with an `if`/`else if`/`else` that shows or hides an object based on a condition.
   - A script that calls `answer` with multiple buttons (async) and uses the result.
3. Verify:
   - Correct number of host calls.
   - Correct sequence of calls.
   - Correct final state of locals and globals (lowercased keys).
   - Variable case-insensitivity: `put 1 into MyVar` then `get myvar` returns `"1"`.

**Acceptance:** `npm test` passes integration tests.

---

## Task 17 — Final verification

Run the full suite and confirm the spec is complete.

**Steps:**
1. `npm run typecheck` — must exit 0.
2. `npm test` — all tests pass, PBTs run 200 examples each.
3. `npm run build` — production build succeeds.
4. `npm run lint` — no errors (warnings acceptable if pre-existing).
5. Confirm `src/interp/` contains exactly the files listed in the design module map (no extra files except tests):
   `ast.ts`, `errors.ts`, `tokenizer.ts`, `parser.ts`, `navigation.ts`, `evaluator.ts`, `messageQueue.ts`.
6. Confirm no import in `src/interp/` crosses the forbidden boundaries in REQ-9.1 (grep for imports from
   `src/ui`, `src/summon`, etc.). Confirm `evaluator.ts` does not import `tokenizer.ts` or `parser.ts`.
7. Parse all three fixture scripts from `stack-model` spec (`quiz`, `adventure`, `flashcards`) and verify they
   parse without errors (add a smoke test that loads each fixture JSON, parses every script field, and asserts
   no `NecroTalkError`).
8. Confirm `evaluate(...)` and `dispatchMessage(...)` signatures return `Promise<void>` and all tests `await` them.
9. Confirm `formatError` always appends a period — grep for `formatError` calls and spot-check messages.

**Acceptance:** All nine checks pass. The spec is done when this task is green.
