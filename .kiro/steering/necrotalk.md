---
inclusion: fileMatch
fileMatchPattern: "src/interp/**"
---

# NecroTalk — Interpreter Steering

This file is active whenever you work on files under `src/interp/`. It defines the exact grammar, module
structure, error style, and out-of-scope list for the NecroTalk interpreter. The grammar below mirrors
`docs/BRIEF.md` section 4; if they ever disagree, the brief wins and this file must be updated.

## What NecroTalk is

NecroTalk is a frozen subset of HyperTalk. The grammar below is the complete spec for the hackathon. Do not
add commands, functions, or syntax not listed here. Phase 2 items are noted; do not implement them until
specs 1–7 are done.

## Module structure (enforce strictly)

```
src/interp/
├── tokenizer.ts      # Tokenizer only — input: string, output: Token[]
├── parser.ts         # Recursive-descent parser and AST printer — input: Token[], output: AST
├── ast.ts            # AST node type definitions only — no logic
├── navigation.ts     # Pure resolveNavigation(target, index, count, names) — no host dependency
├── evaluator.ts      # Tree-walking evaluator — imports ast.ts types, NOT tokenizer or parser
├── messageQueue.ts   # Message dispatch: object → card → background → stack
└── errors.ts         # NecroTalkError type and error-message helpers
```

- The evaluator **must not** import `tokenizer.ts` or `parser.ts` at runtime — only `ast.ts`.
- Each file has a single responsibility. Do not merge phases.
- `eval` is **forbidden** anywhere in this directory.

## Grammar — frozen subset

### Structure

```
on <handlerName> [param, ...]
  <statements>
end <handlerName>
```

System handlers: `mouseUp`, `mouseDown`, `openCard`, `closeCard`, `openStack`.
Custom handlers are invoked by name: a statement `<name> [arg, arg...]` calls the handler `<name>` in the
same script; if no such handler exists, it is a runtime error `Unknown command "<name>"`.
Message passing order: object, card, background, stack.
Comments start with `--`.

### Navigation

```
go to card <N>
go to card "<Name>"
go next
go prev
go first
go last
visual effect dissolve | wipe left | wipe right | scroll up   -- applied to the next go
```

### Data and properties

```
put <expr> into <container>         -- container: field "<Name>", a variable, or it
put <expr> before <container>
put <expr> after <container>
get <expr>                          -- sets `it`
set [the] <property> of <object> to <expr>
the <property> of <object>          -- readable form
global <varName>                    -- declares a stack-wide variable
answer <expr> [with <btn1> [or <btn2> [or <btn3>]]]   -- result in `it`
ask <expr> [with <default>]         -- result in `it`
```

- Object references: `button <expr>`, `field <expr>`, `image <expr>`, `card <expr>`, and `me`. The name is any
  expression, usually a string literal, so `button x` with a variable `x` is valid. `background` and `stack`
  references, and references with no name other than `me`, are parse errors in this version.
- `me` is the object whose script is currently running. When a message passes up the chain, `me` becomes the card,
  background, or stack whose script handles it. The dispatcher supplies this to the evaluator.
- A field reference in expression position evaluates to the field's text: `put field "Score" + 1 into field "Score"`.
- A bare `the <name>` with no object is valid only for `the date` and `the time`; anything else is a runtime error
  `Unknown property "<name>"`.
- Reserved words (every keyword in the tokenizer) cannot be used as variable or handler names; the parser rejects
  them with `"<word>" is a reserved word`.
- `do` and `sort` are rejected at parse time with the exact messages from the error examples below, so Summon can
  catch them before a script is loaded.
- `answer` with no `with` means one "OK" button. More than three buttons is a parse error, as in HyperCard.
- Variable scope: variables are local to the running handler; `global <var>` makes that name read and write the
  stack-wide globals map for the rest of the handler. `it` is always local. The one exception is the
  `implicitGlobals` option of `evaluate` (used by the message box, as in HyperCard): in the handler named in that
  `evaluate` call, every variable — `it` and parameters included — reads and writes the globals map with no
  declaration. Handlers it calls by name keep normal local scope. This is an embedding option, not syntax; scripts
  cannot turn it on.

### Control flow

```
if <expr> then <stmt>
if <expr> then
  <statements>
[else
  <statements>]
end if

repeat <N> times
  <statements>
end repeat

repeat with <var> = <a> to <b>
  <statements>
end repeat

repeat while <expr>
  <statements>
end repeat

exit <handlerName>
next repeat
exit repeat
pass <handlerName>   -- hand the message on to the next object in the message path (object, card, background, stack)
```

`else if <expr> then` chains share a single `end if`, as in HyperTalk; they parse to nested if statements.

### Visibility and feedback

```
show <object>
hide <object>
beep
```

### Expressions

- Literals: numbers, strings in double quotes, `true`, `false`. Variables: unquoted identifiers.
- Arithmetic: `+`, `-`, `*`, `/`, `mod`, `^`, and unary minus.
- Concatenation: `&` and `&&` (with space).
- Grouping parentheses `( <expr> )` anywhere an expression is allowed, including computed object names such as
  `field ("Q" & n)`. An object name binds tightly, so `field "Score" + 1` means `(field "Score") + 1`.
- Comparison: `=`, `<>`, `<`, `>`, `<=`, `>=`, also `is`, `is not`, `contains`.
- Logic: `and`, `or`, `not`.

### Functions

```
the number of cards
the number of words | lines | chars of <expr>
the date
the time
random(<N>)
length(<expr>)
word <N> of <expr>
line <N> of <expr>
char <N> of <expr>
```

- Chunks may nest for reading (`char 1 of word 2 of x`). This fell out of the parser design at no cost and is
  allowed.
- Any `<name>(<args>)` parses as a function call; calling a function that does not exist is a runtime error
  `Unknown function "<name>"` with the line number. Built-in functions check their argument count: `random` and
  `length` take exactly one argument, otherwise `Line N: random expects 1 argument`.
- Calling a handler by name is limited to 200 nested calls; deeper recursion is a runtime error. Inside a handler
  that was called directly (not via a message), `pass` simply ends that handler.

## Phase 2 — do not implement yet

These are allowed in the interpreter design (do not make the architecture block them) but no code should be
written for them until the core is implemented, tested, and Summon works end to end:

1. `item N of <expr>` chunk with comma delimiter (read-only), and `the number of items of <expr>`.
2. `find "<text>"` — jump to the first card after the current one whose fields contain the text, highlight the
   field. No `find whole`, no `find in field`.
3. `play <notes>` (`play "c e g c5h"`) and `play stop` — one synthesized voice via Web Audio, one instrument.
4. `send "<message>" to <object>` — dispatch through the normal handler chain. No `send ... to HyperCard` or
   to other stacks.

## Out of scope — never implement during the hackathon

- Paint commands.
- External commands (XCMD/XFCN).
- Menus.
- `sort`.
- `do` — it is eval and breaks ahead-of-time validation of generated scripts.
- Chunk ranges (`word 2 to 4`).
- Chunks as `put` targets.
- Number formatting.

## Error message style

- Errors must include the **line number** and a plain-English message referencing NecroTalk syntax.
- Format: `Line <N>: <message>.`
- Examples:
  - `Line 3: Expected "end mouseUp" but found "end click".`
  - `Line 7: Unknown command "sort". NecroTalk does not support sort.`
  - `Line 12: "do" is not allowed in NecroTalk.`
  - `Line 4: Unknown function "foo".`
  - `Line 9: Unknown property "target".`
  - `Line 6: random expects 1 argument.`
  - `Line 2: "card" is a reserved word.`
- A newline in a "found" clause reads `end of line`; reaching the end of the input reads `end of script`.
- Handler names appear in messages as written in the source (`"end mouseUp"`); name comparisons are
  case-insensitive.
- Do not expose internal token names or AST node names in error messages shown to users.
- The `NecroTalkError` type in `errors.ts` must carry `line`, `column`, and `message`.
- Host errors: any error thrown by a `HostInterface` call that is not already a `NecroTalkError` (or one of the
  evaluator's internal control-flow signals, which always pass through) is rethrown by the
  evaluator as a `NecroTalkError` at the current statement's line (column 1), with the host's message collapsed to
  one line and its trailing period dropped before `formatError` adds one: `Line 4: No field named "Score".`
  `NecroTalkError`s from the host (for example from a nested dispatch inside `goToCard`) pass through unchanged.
  Every host call in the evaluator goes through this conversion; do not add an unwrapped `host.` call. Host
  messages are shown to users verbatim, so hosts must throw plain-English messages.

## Property-based testing targets (fast-check)

These invariants must have PBT coverage in `*.test.ts` files co-located with the interpreter modules:

1. **Parse → print → parse round-trip**: any valid NecroTalk script printed back to text re-parses to an
   identical AST.
2. **`put`/read invariant**: `put X into it` followed by reading `it` always returns `X`.
3. **Navigation range invariant**: after any sequence of `go` commands, the current card index is always in
   `[0, stack.cards.length - 1]`.
4. **Serialization round-trip**: stack JSON serialized and deserialized is identity (tested via model, but
   interpreter must not break the JSON shape of scripts).
5. **implicitGlobals write invariant**: with `implicitGlobals`, `put X into <var>` leaves `X` in the globals map
   under the lowercased name.

## Message-passing order

Object script → card script → background script → stack script.
If a handler is found, it runs and the message stops unless the handler explicitly passes it with `pass <handlerName>`.
Do not deviate from this order.
