# necrotalk-interpreter — Design

## Module map

```
src/interp/
├── ast.ts              # All AST node type definitions (REQ-1)
├── errors.ts           # NecroTalkError class, formatError helper (REQ-7)
├── tokenizer.ts        # tokenize(source) → Token[] (REQ-2)
├── parser.ts           # parse(source) → ScriptNode, print(ast) → string (REQ-3, REQ-4)
├── navigation.ts       # resolveNavigation(target, index, count, names) → number (REQ-11)
├── evaluator.ts        # evaluate(...), HostInterface, evaluateExpression (REQ-5)
├── messageQueue.ts     # dispatchMessage, MessageContext, PassException (REQ-6)
├── tokenizer.test.ts   # Unit tests for tokenizer
├── parser.test.ts      # Unit tests for parser + PBT parse→print→parse (REQ-8.1)
├── navigation.test.ts  # Unit tests + PBT for resolveNavigation (REQ-8.3)
├── evaluator.test.ts   # Unit tests + PBT put/read (REQ-8.2)
└── messageQueue.test.ts # Unit tests for message dispatch and pass
```

No barrel `index.ts` unless the public surface grows beyond 10 exports. Importers use direct paths.

---

## ast.ts

Pure TypeScript type declarations matching REQ-1. Every node has a `kind` discriminator. Use union types for
`StatementNode`, `ExpressionNode`, `BinaryOp`, `GoTarget`, `RepeatVariant`, etc.

Every statement interface includes a `line: number` field (1-indexed source line).

`ObjectRef` is a lightweight node (not a statement or expression) used wherever a named HyperCard object is referenced:

```ts
export interface ObjectRef {
  type: 'button' | 'field' | 'image' | 'card' | 'background' | 'stack' | 'me';
  name?: ExpressionNode; // absent for 'me' and bare object-type references
}
```

Example structure (abbreviated):

```ts
export type StatementNode =
  | GoStatement
  | PutStatement
  | IfStatement
  | RepeatStatement
  | ExitStatement
  // ...

export interface GoStatement {
  kind: 'go';
  target: GoTarget;
  line: number;
}

export type GoTarget =
  | { type: 'card'; value: number | string }
  | { type: 'next' | 'prev' | 'first' | 'last' };

export interface IfStatement {
  kind: 'if';
  condition: ExpressionNode;
  thenBranch: StatementNode[];
  elseBranch?: StatementNode[];
  line: number;
}

export interface ShowStatement {
  kind: 'show';
  object: ObjectRef;
  line: number;
}

export interface SetStatement {
  kind: 'set';
  property: string;
  object: ObjectRef;
  value: ExpressionNode;
  line: number;
}

// CountExpression replaces "the number of ..." PropertyExpression
export interface CountExpression {
  kind: 'count';
  what: 'cards' | 'words' | 'lines' | 'chars';
  source?: ExpressionNode; // absent for 'cards'
}

// etc.
```

`answer` without a `with` clause: the parser emits `buttons: ["OK"]` (not an empty array).

`else if` is syntactic sugar: the parser creates a nested `IfStatement` in `elseBranch`, not a new AST node.

Add JSDoc comments on the top-level `ScriptNode` and key union types describing the AST design.

---

## errors.ts

```ts
export class NecroTalkError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(message);
    this.name = 'NecroTalkError';
  }
}

// Always appends a period. msg must not itself end with a period.
export function formatError(line: number, column: number, msg: string): string {
  return `Line ${line}: ${msg}.`;
}
```

All tokenizer, parser, evaluator, and navigation errors use this type. The `message` passed to the constructor
should already be formatted via `formatError`.

---

## tokenizer.ts

### Token type and keywords

```ts
export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

export type TokenType =
  | 'keyword'
  | 'identifier'
  | 'number'
  | 'string'
  | 'operator'
  | 'punctuation'
  | 'newline'
  | 'eof';

const KEYWORDS = new Set([
  'on', 'end', 'if', 'then', 'else', 'repeat', 'exit', 'pass',
  'go', 'to', 'card', 'next', 'prev', 'first', 'last',
  'put', 'into', 'before', 'after', 'get', 'set', 'of',
  'global', 'answer', 'with', 'or', 'ask', 'show', 'hide', 'beep',
  'visual', 'effect', 'dissolve', 'wipe', 'left', 'right', 'scroll', 'up',
  'and', 'not', 'is', 'contains',
  'the', 'times', 'while', 'mod',
  'true', 'false',
]);
```

### Tokenization algorithm

1. Maintain `line`, `column`, `pos` cursor.
2. Skip whitespace (space, tab) but not newlines.
3. Recognize `--` comment: skip to end of line.
4. Recognize `"..."` string literal: scan until closing `"`, track escapes (actually NecroTalk has no escape sequences,
   so a `"` inside a string is an error, as are raw newline characters). Strip quotes, store inner text as `value`.
5. Recognize numbers: `[0-9]+(\.[0-9]+)?`.
6. Recognize operators: `<=`, `>=`, `<>`, `<`, `>`, `=`, `+`, `-`, `*`, `/`, `^`, `&`, `&&`. `&&` is two-char.
7. Recognize punctuation: `(`, `)`, `,`.
8. Recognize identifiers: `[A-Za-z_][A-Za-z0-9_]*`. If the identifier (lowercased) is in `KEYWORDS`, emit `keyword`
   with lowercased `value`; else emit `identifier` with original-case `value`.
9. Emit `newline` token for `\n` (track line increment).
10. At end of input, emit `eof`.

Throw `NecroTalkError` for:
- Unterminated string (EOF inside `"`).
- Invalid character (anything not recognized).

---

## parser.ts

### Parsing strategy

Recursive-descent with a lookahead cursor into the token array. Maintain `currentToken` and `peek()` / `advance()` /
`expect(type, value?)` helpers.

```ts
class Parser {
  private tokens: Token[];
  private pos: number;
  
  private get current(): Token { return this.tokens[this.pos]; }
  private advance(): Token { return this.tokens[this.pos++]; }
  private peek(offset = 0): Token { return this.tokens[this.pos + offset]; }
  private expect(type: TokenType, value?: string): Token { /* ... */ }
  private match(type: TokenType, value?: string): boolean { /* ... */ }
  
  parseScript(): ScriptNode { /* ... */ }
  parseHandler(): HandlerNode { /* ... */ }
  parseStatement(): StatementNode { /* ... */ }
  parseExpression(): ExpressionNode { /* ... */ }
  // ...
}

export function parse(source: string): ScriptNode {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  return parser.parseScript();
}
```

### Handling newlines

- `parseScript()` and `parseHandler()` skip leading newlines.
- Statements are separated by newlines. After parsing a statement, consume trailing newlines.
- Multi-line statements (`if`...`end if`, `repeat`...`end repeat`) consume their own structure and trailing newlines.
- `else if <cond> then ...` is parsed as syntactic sugar: emit a nested `IfStatement` in `elseBranch` instead of
  requiring a separate `end if` for the inner branch.

### Error messages

Use `formatError(token.line, token.column, msg)` and throw `NecroTalkError`. Examples:
- `expect('keyword', 'end')` fails → `"Expected 'end' but found 'x'."`.
- Unexpected EOF → `"Unexpected end of file."`.

### Expressions

Use precedence climbing or a Pratt parser for binary operators. Precedence (lowest to highest):
1. `or`
2. `and`
3. `not` (unary)
4. `=`, `<>`, `<`, `>`, `<=`, `>=`, `is`, `is not`, `contains`
5. `&`, `&&`
6. `+`, `-`
7. `*`, `/`, `mod`
8. `^` (exponentiation, right-associative)
9. Unary `-`

Primary expressions: literals (`number`, `string`, `true`, `false`), variables (`identifier`), function calls
(`identifier(args)`), property expressions (`the <property>` / `the <property> of <object>`), chunk expressions
(`word N of <expr>`), parenthesized expressions `( <expr> )`.

---

## print (AST printer)

### Design

Walk the AST and emit NecroTalk source. Indent nested blocks with 2 spaces. Emit newlines between statements.

### Parenthesization rules

The printer must parenthesize a child binary expression when:
1. Its operator precedence is **lower** than the parent operator's precedence, or
2. Its operator precedence is **equal** to the parent and the child is on the **right side of a left-associative**
   operator, or
3. Its operator precedence is **equal** to the parent and the child is on the **left side of a right-associative**
   operator (`^`). Without this, `(a ^ b) ^ c` would print as `a ^ b ^ c` and reparse as `a ^ (b ^ c)`.

Unary and primary operands follow the same idea:
- Unary `not` is treated as precedence 3; its operand is parenthesized when it is an `and`/`or` expression, and a
  `not` child of a tighter operator is parenthesized (so `a is (not b)` never prints as `a is not b`).
- Unary `-` wraps any non-atomic operand, which also prevents `-(-b)` from printing as a `--` comment.
- Chunk indexes/sources and `the number of … of` sources are parenthesized unless they are a literal or variable.

This preserves the original tree structure across a print→parse round-trip. For example:
- `(a + b) * c` — `+` has lower precedence than `*`, so the left operand of `*` must be parenthesized if it is a `+` expression.
- `a - (b - c)` — `-` is left-associative, so the right operand of `-` must be parenthesized if it is also a `-` expression.

Implement a helper `needsParens(child: ExpressionNode, parentOp: BinaryOp, side: 'left' | 'right'): boolean`.

```ts
export function print(script: ScriptNode): string {
  const lines: string[] = [];
  for (const handler of script.handlers) {
    lines.push(`on ${handler.name}${handler.params.length ? ' ' + handler.params.join(', ') : ''}`);
    for (const stmt of handler.body) {
      lines.push(...printStatement(stmt, 1));
    }
    lines.push(`end ${handler.name}`);
    lines.push(''); // blank line between handlers
  }
  return lines.join('\n').trim() + '\n';
}

function printStatement(stmt: StatementNode, indent: number): string[] {
  const ind = '  '.repeat(indent);
  switch (stmt.kind) {
    case 'go':
      return [ind + 'go ' + printGoTarget(stmt.target)];
    case 'put':
      return [ind + `put ${printExpr(stmt.value)} ${stmt.mode} ${printContainer(stmt.target)}`];
    // ...
    case 'if': {
      const lines = [ind + `if ${printExpr(stmt.condition)} then`];
      stmt.thenBranch.forEach(s => lines.push(...printStatement(s, indent + 1)));
      if (stmt.elseBranch) {
        // Check if the else branch is a single IfStatement (else if sugar)
        if (stmt.elseBranch.length === 1 && stmt.elseBranch[0].kind === 'if') {
          const inner = printStatement(stmt.elseBranch[0], indent);
          // Replace the leading "  if" indent with "else if"
          lines.push(ind + 'else ' + inner[0].trimStart());
          lines.push(...inner.slice(1));
        } else {
          lines.push(ind + 'else');
          stmt.elseBranch.forEach(s => lines.push(...printStatement(s, indent + 1)));
          lines.push(ind + 'end if');
        }
      } else {
        lines.push(ind + 'end if');
      }
      return lines;
    }
    // ...
  }
}
```

The printer does not need to preserve comments or exact whitespace, but it must produce valid NecroTalk that
parses to the same AST structure.

---

## navigation.ts

### Purpose

`navigation.ts` encapsulates all navigation resolution logic as a pure function, keeping it testable independent
of the host interface.

```ts
// src/interp/navigation.ts
export function resolveNavigation(
  target: GoTarget,
  currentIndex: number,  // 0-based
  cardCount: number,
  cardNames: string[],   // card names in order
): number;               // returns 0-based index
```

### Rules

- `next`: `(currentIndex + 1) % cardCount` — wraps from last card to first.
- `prev`: `(currentIndex - 1 + cardCount) % cardCount` — wraps from first card to last.
- `first`: `0`.
- `last`: `cardCount - 1`.
- `card <N>` (1-based numeric): converts to `N - 1`; throws `NecroTalkError` if `N < 1` or `N > cardCount`.
- `card <name>` (string): searches `cardNames` case-insensitively; throws `NecroTalkError` if not found.

### Error format

Navigation errors include the source line number from the calling `GoStatement`:
- `Line 3: No card named "Missing".`
- `Line 7: Card index 0 is out of range.`

The evaluator passes `stmt.line` to `resolveNavigation` errors.

---

## evaluator.ts

### Host interface

Defined exactly as in REQ-5.1. The evaluator calls async host methods for navigation and dialogs; all calls to
`goToCard`, `setVisualEffect`, `answer`, and `ask` must be awaited.

### Evaluate function

```ts
export async function evaluate(
  script: ScriptNode,
  handlerName: string,
  args: string[],
  host: HostInterface,
  globals: Map<string, string>,
): Promise<void> {
  // Find the handler (case-insensitive)
  const handler = script.handlers.find(h => h.name.toLowerCase() === handlerName.toLowerCase());
  if (!handler) return; // handler not found, silently return

  // Set up local scope (all keys lowercased)
  const locals = new Map<string, string>();
  const globalDecls = new Set<string>(); // names declared global in this handler
  for (let i = 0; i < handler.params.length; i++) {
    locals.set(handler.params[i].toLowerCase(), args[i] ?? '');
  }

  // Execution budget counter — mutable object threaded through executeStatement
  const budget = { count: 0 };

  try {
    for (const stmt of handler.body) {
      await executeStatement(stmt, locals, globalDecls, globals, host, budget);
    }
  } catch (e) {
    if (e instanceof ExitHandlerException) {
      if (e.handlerName.toLowerCase() === handlerName.toLowerCase()) {
        return; // exit this handler
      }
      throw e; // exit a different handler (error)
    }
    throw e;
  }
}
```

### Variable scoping

- All variable name keys are stored **lowercased** in both `locals` and `globals`.
- `global <varName>` adds the lowercased name to `globalDecls`; subsequent reads and writes for that name go to `globals`.
- An undeclared, unset variable evaluates to its own lowercased name (HyperCard behavior).

### Statement execution budget

`executeStatement` is an `async` function. Its signature is:
```ts
async function executeStatement(
  stmt: StatementNode,
  locals: Map<string, string>,
  globalDecls: Set<string>,
  globals: Map<string, string>,
  host: HostInterface,
  budget: { count: number },
): Promise<void>
```

At the start of every call, `budget.count++`. If `budget.count > 100_000`, throw:
```ts
throw new NecroTalkError(formatError(stmt.line, 1, 'Script ran too long'), stmt.line, 1);
```

The `budget` object is passed through all recursive `executeStatement` calls so nested loops share the same counter.

For control flow:
- `if`: evaluate condition (coerce to boolean), execute thenBranch or elseBranch.
- `repeat times`: loop N times.
- `repeat with`: loop with counter variable.
- `repeat while`: loop while condition is true.
- `exit repeat` / `next repeat`: throw exception, caught by the repeat loop.
- `exit <handler>`: throw `ExitHandlerException`.

For `put`, `get`, `set`, call host or update locals/globals. For `go`, call `resolveNavigation` then
`await host.goToCard(resolvedIndex)`. Pass the `GoStatement`'s `line` to `resolveNavigation` for error reporting.

### Expression evaluation

```ts
function evaluateExpression(
  expr: ExpressionNode,
  locals: Map<string, string>,
  globalDecls: Set<string>,
  globals: Map<string, string>,
  host: HostInterface,
  currentLine: number,
): string {
  switch (expr.kind) {
    case 'literal':
      return String(expr.value);
    case 'variable': {
      const key = expr.name.toLowerCase();
      if (globalDecls.has(key)) return globals.get(key) ?? '';
      if (locals.has(key)) return locals.get(key)!;
      if (globals.has(key)) return globals.get(key)!;
      return key; // HyperCard: unset variable evaluates to its own name
    }
    case 'binary': {
      const left = evaluateExpression(expr.left, locals, globalDecls, globals, host, currentLine);
      const right = evaluateExpression(expr.right, locals, globalDecls, globals, host, currentLine);
      return evaluateBinaryOp(expr.op, left, right, currentLine);
    }
    // ...
  }
}
```

Arithmetic ops coerce strings to numbers; if coercion fails, throw `NecroTalkError` at `currentLine`. Comparison
ops: numeric if both values parse as numbers, else string. `contains` does substring search. `&` and `&&`
concatenate (latter with space).

### Built-in functions and properties

Handled in expression evaluation for `FunctionCallExpression`, `PropertyExpression`, `CountExpression`, and
`ChunkExpression`. `CountExpression` with `what: 'cards'` calls `host.getCardCount()`;
`what: 'words' | 'lines' | 'chars'` evaluates the source expression and counts. Out-of-range chunk access
returns `""`.

---

## messageQueue.ts

### Pass exception

```ts
export class PassException extends Error {
  constructor(public readonly handlerName: string) {
    super(`pass ${handlerName}`);
    this.name = 'PassException';
  }
}
```

The evaluator throws this when `pass <handlerName>` is executed. The message dispatcher catches it and continues
the chain.

### Dispatch message

```ts
export async function dispatchMessage(
  message: string,
  args: string[],
  context: MessageContext,
  host: HostInterface,
  globals: Map<string, string>,
): Promise<void> {
  const scripts = [
    context.objectScript,
    context.cardScript,
    context.backgroundScript,
    context.stackScript,
  ].filter((s): s is string => s != null && s.length > 0);

  // Parse each source string at most once per dispatch call
  const parseCache = new Map<string, ScriptNode>();
  const getParsed = (src: string): ScriptNode => {
    if (!parseCache.has(src)) parseCache.set(src, parse(src));
    return parseCache.get(src)!;
  };

  for (const scriptSource of scripts) {
    const scriptNode = getParsed(scriptSource);
    try {
      await evaluate(scriptNode, message, args, host, globals);
      return; // handler ran without pass; stop
    } catch (e) {
      if (e instanceof PassException && e.handlerName.toLowerCase() === message.toLowerCase()) {
        // continue to next script in chain
        continue;
      }
      throw e; // other error; propagate
    }
  }
  // No handler found anywhere; silently return
}
```

The logic: try each script in order. If `evaluate` resolves normally, stop. If it throws `PassException` for the
same handler, continue. If it throws anything else, propagate. Each source string is parsed at most once per
dispatch call via the local `parseCache`.

---

## Testing strategy

### Unit tests

- `tokenizer.test.ts`: test each token type, keywords, operators, strings, comments, errors (unterminated string, invalid char).
- `parser.test.ts`: test each statement and expression type, nested structures, error cases (missing `end`, unexpected EOF). Include printer parenthesization tests.
- `navigation.test.ts`: test `resolveNavigation` — all target types, wrap-around, out-of-range errors, unknown name errors.
- `evaluator.test.ts`: test statement execution, expression evaluation, built-in functions, control flow, variable case-insensitivity, execution budget.
- `messageQueue.test.ts`: test pass behavior, handler not found, multiple handlers, async dispatch.

### PBT

- **parse→print→parse**: in `parser.test.ts`, generate arbitrary `ScriptNode` AST using fast-check, print it,
  parse the result, strip positions with `stripPositions()`, assert deep-equal. Fast-check arbitrary constraints:
  - String literal values exclude `"`, `\n`, `\r`.
  - Number literals: non-negative finite decimals only.
  - Identifiers: match `[A-Za-z_][A-Za-z0-9_]*` and are not NecroTalk keywords.
  Run 200 examples.

- **put/read invariant**: in `evaluator.test.ts`, generate arbitrary string values (excluding `"`, `\n`, `\r`),
  create a mock `HostInterface`, parse and evaluate `put <value> into it`, then read `it` from locals, assert equal.
  200 runs.

- **navigation invariant**: in `navigation.test.ts`, test `resolveNavigation` directly with generated sequences of
  valid `go` commands for a 5-card stack, assert result always in `[0, 4]`. 200 runs.

### Mock HostInterface

For unit and PBT tests, provide a `MockHost` class implementing `HostInterface`. Async methods (`goToCard`,
`setVisualEffect`, `answer`, `ask`) return `Promise.resolve(...)`. The mock tracks state (current card index,
field values, visible objects) and records call history for assertions.

---

## Operator precedence table

For the parser:

| Precedence | Operators | Associativity |
|---|---|---|
| 1 (lowest) | `or` | left |
| 2 | `and` | left |
| 3 | `not` | prefix |
| 4 | `=`, `<>`, `<`, `>`, `<=`, `>=`, `is`, `is not`, `contains` | left |
| 5 | `&`, `&&` | left |
| 6 | `+`, `-` (binary) | left |
| 7 | `*`, `/`, `mod` | left |
| 8 | `^` | right |
| 9 | `-` (unary) | prefix |

Implement precedence climbing in `parseExpression()` or use a table-driven approach.

---

## Phase 2 readiness

The AST design accommodates Phase 2 features:
- `ChunkExpression.chunkType` can add `'item'`.
- `StatementNode` union can add `FindStatement`, `PlayStatement`, `SendStatement`.
- `FunctionCallExpression` can recognize `'the number of items of'`.

The parser and evaluator will reject unrecognized nodes in this spec, but adding them later requires only extending
the unions and adding cases to the parser/evaluator switches. No architectural refactor is needed.

---

## Dependencies

No new runtime dependencies. Fast-check and Vitest are already present from `stack-model`. The interpreter is
self-contained TypeScript code.
