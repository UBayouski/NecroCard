# necrotalk-interpreter — Requirements

## Overview

Implement the NecroTalk interpreter: tokenizer, recursive-descent parser to an AST, AST printer (for PBT round-trip),
tree-walking evaluator with message passing, and a host interface that decouples the interpreter from DOM/UI concerns.
This is spec 2 of 8. The grammar is frozen; Phase 2 features (`item` chunks, `find`, `play`, `send`) must not be
implemented, but the architecture must not block adding them later.

---

## REQ-1 — AST node types

### REQ-1.1 — AST structure

All AST node type definitions must be in `src/interp/ast.ts`. This file contains type declarations only — no logic.
Every node must have a discriminated `kind` field for type narrowing.

### REQ-1.2 — Handler node

```ts
interface HandlerNode {
  kind: 'handler';
  name: string;        // handler name (e.g. "mouseUp", "doSomething")
  params: string[];    // parameter names
  body: StatementNode[];
}
```

### REQ-1.2a — ObjectRef node

`ObjectRef` is a lightweight AST node (not a statement or expression) used wherever the grammar refers to a named
HyperCard object:

```ts
interface ObjectRef {
  type: 'button' | 'field' | 'image' | 'card' | 'background' | 'stack' | 'me';
  name?: ExpressionNode; // absent for 'me' and bare 'stack'/'card' references
}
```

`ObjectRef` is used in: `ShowStatement`, `HideStatement`, `SetStatement`, `PropertyExpression`, and field containers
in `PutStatement` / `GetStatement`.

### REQ-1.3 — Statement nodes

All statements share a base:
```ts
interface StatementBase {
  kind: string;
  line: number; // 1-indexed source line where this statement begins
}
```

Statement node types (discriminated union on `kind`):

- `GoStatement`: `{ kind: 'go', target: GoTarget, line: number }`
  where `GoTarget` is `{ type: 'card', value: number | string } | { type: 'next' | 'prev' | 'first' | 'last' }`.
- `VisualEffectStatement`: `{ kind: 'visualEffect', effect: 'dissolve' | 'wipe left' | 'wipe right' | 'scroll up', line: number }`.
- `PutStatement`: `{ kind: 'put', value: ExpressionNode, mode: 'into' | 'before' | 'after', target: ContainerNode, line: number }`.
- `GetStatement`: `{ kind: 'get', value: ExpressionNode, line: number }`.
- `SetStatement`: `{ kind: 'set', property: string, object: ObjectRef, value: ExpressionNode, line: number }`.
- `GlobalStatement`: `{ kind: 'global', varName: string, line: number }`.
- `AnswerStatement`: `{ kind: 'answer', prompt: ExpressionNode, buttons: string[], line: number }`.
  When no `with` clause is present, `buttons` defaults to `["OK"]`.
- `AskStatement`: `{ kind: 'ask', prompt: ExpressionNode, default?: ExpressionNode, line: number }`.
- `ShowStatement`: `{ kind: 'show', object: ObjectRef, line: number }`.
- `HideStatement`: `{ kind: 'hide', object: ObjectRef, line: number }`.
- `BeepStatement`: `{ kind: 'beep', line: number }`.
- `IfStatement`: `{ kind: 'if', condition: ExpressionNode, thenBranch: StatementNode[], elseBranch?: StatementNode[], line: number }`.
  `else if <cond> then ...` is parsed as syntactic sugar: a nested `IfStatement` in `elseBranch` (not a new AST node).
- `RepeatStatement`: `{ kind: 'repeat', variant: RepeatVariant, body: StatementNode[], line: number }`
  where `RepeatVariant` is `{ type: 'times', count: ExpressionNode } | { type: 'with', varName: string, from: ExpressionNode, to: ExpressionNode } | { type: 'while', condition: ExpressionNode }`.
- `ExitStatement`: `{ kind: 'exit', target: 'repeat' | string, line: number }` (string is handler name).
- `NextRepeatStatement`: `{ kind: 'nextRepeat', line: number }`.
- `PassStatement`: `{ kind: 'pass', handlerName: string, line: number }`.

### REQ-1.4 — Expression nodes

All expressions share a base:
```ts
interface ExpressionBase {
  kind: string;
}
```

Expression node types:
- `LiteralExpression`: `{ kind: 'literal', value: number | string | boolean }`.
  Number literals are non-negative and finite (no Infinity, NaN, or scientific notation).
- `VariableExpression`: `{ kind: 'variable', name: string }`.
  Variable names are case-insensitive; the parser stores them lowercased.
- `BinaryExpression`: `{ kind: 'binary', op: BinaryOp, left: ExpressionNode, right: ExpressionNode }`
  where `BinaryOp` covers arithmetic (`+`, `-`, `*`, `/`, `mod`, `^`), comparison (`=`, `<>`, `<`, `>`, `<=`, `>=`, `is`, `is not`, `contains`), logic (`and`, `or`), concatenation (`&`, `&&`).
- `UnaryExpression`: `{ kind: 'unary', op: 'not' | '-', operand: ExpressionNode }`.
- `FunctionCallExpression`: `{ kind: 'functionCall', name: string, args: ExpressionNode[] }`
  for functions like `random(N)`, `length(s)`.
- `PropertyExpression`: `{ kind: 'property', property: string, object?: ObjectRef }`
  for `the <property>` and `the <property> of <objectRef>`.
- `ChunkExpression`: `{ kind: 'chunk', chunkType: 'word' | 'line' | 'char', index: ExpressionNode, source: ExpressionNode }`.
- `CountExpression`: `{ kind: 'count', what: 'cards' | 'words' | 'lines' | 'chars', source?: ExpressionNode }`.
  `'cards'` has no `source` (calls `host.getCardCount()`). `'words'`, `'lines'`, `'chars'` require a `source` expression
  (the string to count in). This node replaces the old `the number of ...` handling.

### REQ-1.5 — Container nodes

```ts
interface ContainerNode {
  kind: 'field' | 'variable' | 'it';
  ref?: ObjectRef;  // present when kind is 'field'; ref.type === 'field'
  name?: string;    // present for 'variable', absent for 'it'
}
```

Field containers use an `ObjectRef` with `type: 'field'` rather than a bare string name.

### REQ-1.6 — Complete Script node

```ts
interface ScriptNode {
  kind: 'script';
  handlers: HandlerNode[];
}
```

The parser entry point returns a `ScriptNode`.

### REQ-1.7 — No Phase 2 nodes

Do not add AST nodes for `item` chunks, `find`, `play`, or `send`. The architecture must accommodate them later
(e.g., `ChunkExpression` has a `chunkType` that can be extended; `StatementNode` is a union that can grow), but
do not implement them in this spec.

## REQ-2 — Tokenizer

### REQ-2.1 — Token types

```ts
interface Token {
  type: TokenType;
  value: string;   // lexeme
  line: number;    // 1-indexed
  column: number;  // 1-indexed
}

type TokenType =
  | 'keyword'      // on, end, if, then, else, repeat, exit, pass, go, put, get, set, global, answer, ask, show, hide, beep, visual, effect, to, into, before, after, of, with, or, and, not, is, contains, the, times, while, true, false
  | 'identifier'   // unquoted names
  | 'number'       // integer or decimal literals
  | 'string'       // double-quoted strings
  | 'operator'     // +, -, *, /, mod, ^, =, <>, <, >, <=, >=, &, &&
  | 'punctuation'  // ( ) , "
  | 'newline'      // line separator (significant in NecroTalk)
  | 'eof';
```

### REQ-2.2 — Tokenizer function

```ts
// src/interp/tokenizer.ts
export function tokenize(source: string): Token[];
```

- Input: NecroTalk source string.
- Output: array of tokens including `newline` and `eof`.
- Comments (`--` to end of line) are stripped and do not appear in the token stream.
- String literals are tokenized with their quotes stripped (`"hello"` → `{ type: 'string', value: 'hello' }`).
  String literals may not contain `"` (double-quote) or newline characters (`\n`, `\r`); NecroTalk has no escape sequences.
- Keywords are case-insensitive (`On`, `ON`, `on` all tokenize as `keyword` with `value: 'on'` normalized to lowercase).
- Numbers are tokenized as `number` type. Only non-negative decimal literals are valid (no Infinity, NaN, scientific
  notation). The `value` field holds the string representation.
- Whitespace (except newlines) is skipped.

### REQ-2.3 — Error handling

Tokenizer errors (e.g., unterminated string, invalid character) must throw `NecroTalkError` with `line` and `column`.

---

## REQ-3 — Parser

### REQ-3.1 — Parser function

```ts
// src/interp/parser.ts
export function parse(source: string): ScriptNode;
```

- Input: NecroTalk source string.
- Output: a `ScriptNode` AST.
- The parser calls `tokenize` internally.
- Parsing errors throw `NecroTalkError` with `line`, `column`, and a plain-English message in the steering format.

### REQ-3.2 — Recursive-descent structure

The parser must use a recursive-descent approach with explicit functions for each grammar production:
- `parseScript()`
- `parseHandler()`
- `parseStatement()`
- `parseExpression()` / `parseBinaryExpression()` / `parsePrimary()`
- `parseContainer()`
- etc.

Do not use a parser combinator library or a parser generator. The hand-written parser is an explicit requirement.

### REQ-3.3 — Significant newlines

Statements are separated by newlines. Multi-line statements (like `if`...`end if`)
consume their own `end` keyword and newlines. Single-line `if <expr> then <stmt>` ends at the newline.
`else if <cond> then ...` is syntactic sugar parsed as a nested `IfStatement` in `elseBranch`.

### REQ-3.4 — Error messages

Parser errors must follow the steering format:
- `Line <N>: <message>.`  (always ends with a period)
- Use plain English; do not expose token type names or AST node names.
- Examples:
  - `Line 5: Expected "end if" but found "end repeat".`
  - `Line 10: Unexpected end of file inside handler.`

---

## REQ-4 — AST printer

### REQ-4.1 — Printer function

```ts
// src/interp/parser.ts (or printer.ts if extracted)
export function print(ast: ScriptNode): string;
```

- Input: a `ScriptNode` AST.
- Output: NecroTalk source string that, when parsed again, yields an AST structurally identical to the input.
- The printer is required for the parse→print→parse PBT round-trip.

### REQ-4.2 — Round-trip correctness

For any valid NecroTalk source `s`:
```
print(parse(s)) when parsed again must yield an AST deep-equal to parse(s)
```

The printed format need not match the original source exactly (whitespace, comment placement, case may differ),
but it must be valid NecroTalk that produces the same AST.

The PBT uses a `stripPositions(ast: ScriptNode): ScriptNode` helper that returns a copy of the AST with the `line`
field set to 0 on every statement node before deep-equal comparison.

### REQ-4.3 — Correct parenthesization

The printer must parenthesize a child expression when its operator precedence is lower than the parent operator's
precedence, or equal precedence on the right side of a left-associative operator. This preserves left-associativity
and ensures the round-trip parse of printed output produces the same AST.

---

## REQ-5 — Evaluator and host interface

### REQ-5.1 — Host interface

The evaluator must not directly call DOM APIs or import from `src/ui/`. All side effects (navigation, dialogs, visual
effects, property access, beep) are routed through a host interface.

```ts
// src/interp/evaluator.ts (or host.ts)
export interface HostInterface {
  // Navigation — async; goToCard receives a resolved 0-based index
  goToCard(index: number): Promise<void>;
  getCurrentCardIndex(): number;
  getCardCount(): number;
  getCardNames(): string[]; // returns card names in order, for name-based navigation
  
  // Visual effect (queued; applied on next navigation) — async
  setVisualEffect(effect: 'dissolve' | 'wipe left' | 'wipe right' | 'scroll up'): Promise<void>;
  
  // Dialogs — async (await user response)
  answer(prompt: string, buttons: string[]): Promise<string>; // returns button label clicked
  ask(prompt: string, defaultValue: string): Promise<string>; // returns user input

  // Object visibility — synchronous
  showObject(ref: ObjectRef): void;
  hideObject(ref: ObjectRef): void;
  
  // Property get/set — synchronous
  getProperty(ref: ObjectRef, property: string): string;
  setProperty(ref: ObjectRef, property: string, value: string): void;
  
  // Field access (for put/get into field) — synchronous
  getFieldText(ref: ObjectRef): string;
  setFieldText(ref: ObjectRef, text: string): void;
  
  // Feedback — synchronous
  beep(): void;
  
  // Built-in functions — synchronous
  getDate(): string;
  getTime(): string;
  random(n: number): number;
}
```

### REQ-5.2 — Evaluator function

```ts
export interface EvaluateOptions {
  me?: ResolvedObjectRef;      // the object whose script is running; supplied by dispatchMessage
  implicitGlobals?: boolean;   // default false; see below
}

export function evaluate(
  script: ScriptNode,
  handlerName: string,
  args: string[],
  host: HostInterface,
  globals: Map<string, string>,
  options?: EvaluateOptions,
): Promise<void>;
```

- `script`: the parsed AST.
- `handlerName`: the handler to invoke (e.g., `"mouseUp"`). Matched case-insensitively.
- `args`: arguments passed to the handler (empty array for most system handlers).
- `host`: the host interface for side effects.
- `globals`: a shared map of global variables (modified in place by `global <var>` statements).
- `options.me`: `me` for this handler. Without it, any use of `me` is a runtime error.
- `options.implicitGlobals`: see "Implicit globals" below.

The evaluator walks the AST and executes the handler's body. It maintains a local scope (`Map<string, string>`)
for local variables and the special `it` variable. All values are strings (NecroTalk is dynamically typed with
coercion; the evaluator coerces numbers as needed for arithmetic).

Variable and handler names are case-insensitive; all keys in local scope and globals maps are stored lowercased.
A `global <varName>` statement marks that name as global in the current handler invocation; subsequent reads and
writes go to the shared globals map. An undeclared, unset variable (not in locals, not declared global, not in
globals) evaluates to its own name (lowercased), matching HyperCard behavior.

**Implicit globals.** When `options.implicitGlobals` is true, every variable in the handler named in the `evaluate`
call — including `it`, the handler's parameters and `repeat with` counters — reads and writes the `globals` map
directly, with no `global` declaration (`it` is stored under the key `it`). Unset variables still evaluate to their
own name, and still start empty as `put` targets. Parameters are written on entry like any variable, so a parameter
with no argument sets that global to empty. Handlers called by name from that handler use normal local
scoping. This exists for embedders: the browser message box uses it so its variables are global, as in HyperCard's
message box. Scripts cannot enable it.

**Host errors.** Every call to a `HostInterface` method is wrapped: if it throws anything that is not a
`NecroTalkError` (or one of the evaluator's internal control-flow signals), the evaluator throws
`NecroTalkError(formatError(line, 1, msg), line, 1)` where `line` is the current statement's line and `msg` is the
host error's message (or `String(thrown)`) collapsed to one line with any trailing period removed; an empty message
becomes `The host reported an error`. Example: a host that throws `Error('No field named "Score"')` while running
line 4 yields `Line 4: No field named "Score".` A `NecroTalkError` thrown by the host — for example from a nested
`openCard` dispatch inside `goToCard` — passes through unchanged, keeping its own line.

The evaluator tracks a statement execution count internally. After 100,000 statements it throws `NecroTalkError`
with message `"Script ran too long."` at the current statement's line and column 1.

### REQ-5.3 — Expression evaluation

Implement a separate internal `evaluateExpression(expr: ExpressionNode, scope: Scope, currentLine: number): string`
helper, where `Scope` bundles locals, declared globals, the globals map, the host, `me` and the implicitGlobals flag. All expressions return strings; arithmetic operations coerce to numbers, perform the operation, and return
a string result. Arithmetic on a non-numeric string value throws `NecroTalkError` with the current statement's
line number.

### REQ-5.4 — Control flow

- `exit <handler>`: throw a special `ExitHandlerException` caught by the evaluator's handler runner.
- `exit repeat`: throw a special `ExitRepeatException` caught by the repeat loop.
- `next repeat`: throw a special `NextRepeatException` caught by the repeat loop.
- Use JavaScript control flow (`if`, `while`, `for`) to implement NecroTalk control flow; do not simulate a stack machine.
- All async host calls must be awaited; `executeStatement` and `evaluate` are `async` functions.

### REQ-5.5 — No Phase 2 evaluation

Do not implement evaluation for `item` chunks, `find`, `play`, or `send`. The evaluator must throw a clear error if
it encounters an AST node it does not recognize (defensive programming for future extensions).

---

## REQ-6 — Message passing

### REQ-6.1 — Message dispatch

```ts
// src/interp/messageQueue.ts
export async function dispatchMessage(
  message: string,
  args: string[],
  context: MessageContext,
  host: HostInterface,
  globals: Map<string, string>,
): Promise<void>;

interface MessageContext {
  objectScript?: string;       // current object's script source
  cardScript: string;           // current card's script source
  backgroundScript: string;     // current card's background script source
  stackScript: string;          // stack script source
}
```

- Each non-empty source string is parsed at most once per `dispatchMessage` call (using a local
  `Map<string, ScriptNode>` cache keyed by source string).
- Try to find and run the handler in `objectScript` first. If found and it does not `pass`, stop.
- If not found or `pass` is called, try `cardScript`.
- Then `backgroundScript`.
- Then `stackScript`.
- If no handler is found anywhere, do nothing (silently ignore the message).

### REQ-6.2 — Pass handling

When a handler executes `pass <handlerName>`, the dispatcher must continue the search at the next level in the
message path. The evaluator signals `pass` by throwing a `PassException` carrying the handler name. The message
dispatcher catches this and continues the chain.

### REQ-6.3 — Error propagation

If any handler throws a `NecroTalkError` or another unhandled exception, the dispatcher does not catch it — the error
propagates to the caller (UI browse mode will display the error). Errors raised by host calls reach the dispatcher
already converted to `NecroTalkError` with a line number (REQ-5.2, "Host errors").

---

## REQ-7 — Error type

### REQ-7.1 — NecroTalkError

```ts
// src/interp/errors.ts
export class NecroTalkError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  );
}
```

Format the `message` field according to the steering: `Line <N>: <message>.` where `<message>` is plain English.

### REQ-7.2 — Error helper

Provide a helper to format errors consistently:

```ts
export function formatError(line: number, column: number, msg: string): string {
  return `Line ${line}: ${msg}.`;
}
```

The helper always appends a period. The `msg` argument must not itself end with a period.
Use this helper everywhere errors are thrown or logged.

---

## REQ-8 — Property-based testing (fast-check)

### REQ-8.1 — Parse → print → parse round-trip

Generate arbitrary valid NecroTalk ASTs, print them, parse the printed result, and assert the two ASTs are
structurally identical after stripping position data. Run at least 200 examples.

The fast-check arbitrary must respect these constraints:
- String literal values: exclude `"` (double-quote), `\n`, and `\r`. NecroTalk has no escape sequences.
- Number literals: non-negative, finite decimal values only (no Infinity, NaN, scientific notation).
- Identifiers: must match `[A-Za-z_][A-Za-z0-9_]*` and must not be NecroTalk keywords (build a set of reserved
  words and filter generated names against it).

The arbitrary should cover:
- All statement types.
- Nested control flow (if inside repeat, etc.).
- All expression types (literals, variables, binary ops, function calls, chunks, CountExpression).
- Handler parameters.
- Unicode strings in string literals (excluding `"`, `\n`, `\r`).

Comparison uses `stripPositions(ast: ScriptNode): ScriptNode`, a helper that returns a copy of the AST with the
`line` field set to 0 on every statement node. The PBT asserts:
`expect(stripPositions(reparsed)).toEqual(stripPositions(original))`

### REQ-8.2 — Put/read invariant

Generate arbitrary string values (excluding `"`, `\n`, `\r`), execute `put <value> into it`, then read `it` back.
Assert the read value equals the original. Run at least 200 examples.

Use a mock `HostInterface` that tracks state.

### REQ-8.3 — Navigation range invariant

The pure function `resolveNavigation(target: GoTarget, currentIndex: number, cardCount: number, cardNames: string[]): number`
(in `src/interp/navigation.ts`) must always return a value in `[0, cardCount - 1]` for valid inputs, and must
throw `NecroTalkError` for invalid inputs (unknown card name, out-of-range numeric index).

Navigation wrapping: `next` on the last card wraps to card 0; `prev` on card 0 wraps to `cardCount - 1`.

Generate arbitrary sequences of valid `go` commands and assert that `resolveNavigation` returns a value in
`[0, cardCount - 1]` for a 5-card stack. Also test the evaluator integration with a thin mock host. Run at least
200 examples with sequences of 1 to 20 commands each.

### REQ-8.4 — implicitGlobals write invariant

Generate an identifier (not a reserved word) and a string value (excluding `"`, `\n`, `\r`); evaluate
`put "<value>" into <identifier>` with `implicitGlobals: true`; assert `globals.get(identifier.toLowerCase())`
equals the value. Run at least 200 examples. (The browser message box adds a PBT on top: a value put in the box
round-trips through a handler that declares the global, and back.)

### REQ-8.5 — Host error conversion (unit tests)

For every host-calling statement and expression (`beep`, `go`, `visual effect`, `put` into/after a field, field
reads, `set`, `the <prop> of`, `the date`/`the time`, `the number of cards`, `random`, `answer`, `ask`, `show`,
`hide`), a host that throws a plain `Error` yields a `NecroTalkError` with that statement's line, including inside
nested blocks. A `NecroTalkError` thrown by the host passes through unchanged; a non-`Error` throw is converted;
the period is never doubled.

---

## REQ-9 — Module boundaries

### REQ-9.1 — Strict imports

- `ast.ts`: imports nothing from `src/interp/`. Pure type declarations.
- `errors.ts`: imports nothing from `src/interp/`.
- `tokenizer.ts`: imports `errors.ts`.
- `parser.ts`: imports `tokenizer.ts`, `ast.ts`, `errors.ts`.
- `navigation.ts`: imports `ast.ts`, `errors.ts`. Must not import `tokenizer.ts`, `parser.ts`, or `evaluator.ts`.
- `evaluator.ts`: imports `ast.ts`, `errors.ts`, `navigation.ts`. **Must not** import `tokenizer.ts` or `parser.ts`.
- `messageQueue.ts`: imports `parser.ts`, `evaluator.ts`, `errors.ts`, `ast.ts`.

No file in `src/interp/` may import from `src/ui/`, `src/model/` (except types if needed), `src/summon/`, or
`src/share/`.

### REQ-9.2 — Exports

Public surface of `src/interp/`:

| Export | From |
|---|---|
| `ScriptNode`, `HandlerNode`, `StatementNode`, `ExpressionNode`, `ObjectRef`, etc. (all AST types) | `ast.ts` |
| `tokenize` | `tokenizer.ts` |
| `parse`, `print` | `parser.ts` |
| `resolveNavigation` | `navigation.ts` |
| `evaluate`, `HostInterface` | `evaluator.ts` |
| `dispatchMessage`, `MessageContext` | `messageQueue.ts` |
| `NecroTalkError`, `formatError` | `errors.ts` |

---

## REQ-10 — Built-in functions and properties

### REQ-10.1 — Functions

Implement these in the evaluator's expression evaluator:
- `random(N)`: calls `host.random(N)`.
- `length(s)`: returns the string length.
- `word N of s`: parsed as `ChunkExpression` with `chunkType: 'word'`; splits `s` by whitespace, returns the Nth word (1-indexed).
- `line N of s`: parsed as `ChunkExpression` with `chunkType: 'line'`; splits `s` by `\n`, returns the Nth line (1-indexed).
- `char N of s`: parsed as `ChunkExpression` with `chunkType: 'char'`; returns the Nth character (1-indexed).
- `the number of cards`: parsed as `CountExpression` with `what: 'cards'`; calls `host.getCardCount()`.
- `the number of words of s`: parsed as `CountExpression` with `what: 'words'`; splits source by whitespace, returns count.
- `the number of lines of s`: parsed as `CountExpression` with `what: 'lines'`; splits source by `\n`, returns count.
- `the number of chars of s`: parsed as `CountExpression` with `what: 'chars'`; returns character count.

Out-of-range chunk access (index ≤ 0 or > count) returns an empty string `""`.

### REQ-10.2 — Properties

- `the date`: calls `host.getDate()` and returns its string unchanged. The format is the host's choice; the
  browser host (`browse-mode` REQ-4.9) uses the HyperCard short form, e.g. `11/3/26`.
- `the time`: calls `host.getTime()` and returns its string unchanged. The format is the host's choice; the
  browser host uses the HyperCard short form, e.g. `2:05 PM`.
- `the <property> of <objectRef>`: calls `host.getProperty(ref, property)`.

Chunk expressions (`word N of <expr>`) are evaluated by first evaluating `<expr>`, then splitting and indexing.

---

## REQ-11 — Navigation

### REQ-11.1 — resolveNavigation

```ts
// src/interp/navigation.ts
export function resolveNavigation(
  target: GoTarget,
  currentIndex: number,  // 0-based
  cardCount: number,
  cardNames: string[],   // card names in order (index 0 = first card)
): number; // returns 0-based index
```

- `next`: wraps around — `next` on the last card (index `cardCount - 1`) returns `0`.
- `prev`: wraps around — `prev` on the first card (index `0`) returns `cardCount - 1`.
- `first`: returns `0`.
- `last`: returns `cardCount - 1`.
- `card <name>` (string): searches `cardNames` case-insensitively; throws `NecroTalkError` if not found.
- `card <N>` (number): uses 1-based HyperCard numbering; throws `NecroTalkError` if `N < 1` or `N > cardCount`.

The host's `goToCard(index: number)` receives only the resolved 0-based index.

### REQ-11.2 — Navigation errors

Navigation errors must include the source line number from the originating `GoStatement`. Error message examples:
- `Line 3: No card named "Missing".`
- `Line 7: Card index 0 is out of range.`

---

## REQ-12 — Execution budget

### REQ-12.1 — Statement count limit

The evaluator tracks a statement execution count. After 100,000 statements it throws:
```
NecroTalkError("Script ran too long.", currentLine, 1)
```
The counter is passed as a mutable object `{ count: number }` into `executeStatement` so it can be threaded
through recursive calls without global state.

### REQ-12.2 — Budget test

There must be a test that a script with a tight infinite loop (e.g., `repeat while true`) hits the budget and
throws `NecroTalkError` with the message `"Script ran too long."`.

---

## REQ-13 — No dependencies beyond model types

The interpreter must not add new runtime dependencies. It may import types from `src/model/types.ts` if needed
for the `HostInterface` (e.g., to reference `Stack` or `Card` types), but only types — no runtime imports from
`src/model/`.

Fast-check is already a dev dependency from the `stack-model` spec. Vitest is already configured.
