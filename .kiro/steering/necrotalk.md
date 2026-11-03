---
inclusion: fileMatch
fileMatchPattern: "src/interp/**"
---

# NecroTalk — Interpreter Steering

This file is active whenever you work on files under `src/interp/`. It defines the exact grammar, module
structure, error style, and out-of-scope list for the NecroTalk interpreter.

## What NecroTalk is

NecroTalk is a frozen subset of HyperTalk. The grammar below is the complete spec for the hackathon. Do not
add commands, functions, or syntax not listed here. Phase 2 items are noted; do not implement them until
specs 1–7 are done.

## Module structure (enforce strictly)

```
src/interp/
├── tokenizer.ts      # Tokenizer only — input: string, output: Token[]
├── parser.ts         # Recursive-descent parser — input: Token[], output: AST
├── ast.ts            # AST node type definitions only — no logic
├── evaluator.ts      # Tree-walking evaluator — imports ast.ts types, NOT tokenizer or parser
├── messageQueue.ts   # Message dispatch: object → card → background → stack
└── errors.ts         # NecroTalkError type and error-message helpers
```

- The evaluator **must not** import `tokenizer.ts` or `parser.ts` at runtime — only `ast.ts`.
- Each file has a single responsibility. Do not merge phases.
- `eval` is **forbidden** anywhere in this directory.

## Grammar — frozen subset

### Handlers

```
on <handlerName> [param, ...]
  <statements>
end <handlerName>
```

System handlers: `mouseUp`, `mouseDown`, `openCard`, `closeCard`, `openStack`.
Custom handlers are invoked by name. Comments start with `--`.

### Navigation

```
go to card <N>
go to card "<Name>"
go next
go prev
go first
go last
visual effect dissolve | wipe left | wipe right | scroll up   -- applied to next go
```

### Data and properties

```
put <expr> into <container>
put <expr> before <container>
put <expr> after <container>
get <expr>                          -- sets `it`
set <property> of <object> to <expr>
the <property> of <object>          -- readable form
global <varName>                    -- stack-wide variable
answer <expr> [with <btn1> [or <btn2> [or <btn3>]]]   -- result in `it`
ask <expr> [with <default>]         -- result in `it`
```

Containers: `field "<Name>"`, local variable, `it`.

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
pass <handlerName>   -- hand the message on to the next object in the message path
```

### Visibility and feedback

```
show <object>
hide <object>
beep
```

### Expressions

- Literals: numbers, double-quoted strings, `true`, `false`.
- Variables: unquoted identifiers.
- Arithmetic: `+`, `-`, `*`, `/`, `mod`, `^`.
- Concatenation: `&` (no space), `&&` (with space).
- Comparison: `=`, `<>`, `<`, `>`, `<=`, `>=`, `is`, `is not`, `contains`.
- Logic: `and`, `or`, `not`.

### Built-in functions

```
the number of cards
the number of words of <expr>
the date
the time
random(<N>)
length(<expr>)
word <N> of <expr>
line <N> of <expr>
char <N> of <expr>
```

## Phase 2 — do not implement yet

These are allowed in the interpreter design (do not make the architecture block them) but no code should be
written for them until specs 1–7 are complete:

1. `item N of <expr>` / `the number of items of <expr>` — comma-delimited chunks.
2. `find "<text>"` — jump to first card whose fields contain the text.
3. `play "<notes>"` / `play stop` — one synthesized voice via Web Audio.
4. `send "<message>" to <object>` — dispatch through normal handler chain.

## Out of scope — never implement

- `eval` / `do` — forbidden; bypasses validation.
- Paint commands.
- External commands (XCMD/XFCN).
- `sort`.
- Chunk ranges (`word 2 to 4`), nested chunks, chunks as `put` targets.
- Number formatting functions.
- `send ... to HyperCard` or to other stacks.

## Error message style

- Errors must include the **line number** and a plain-English message referencing NecroTalk syntax.
- Format: `Line <N>: <message>.`
- Examples:
  - `Line 3: Expected "end mouseUp" but found "end click".`
  - `Line 7: Unknown command "sort". NecroTalk does not support sort.`
  - `Line 12: "do" is not allowed in NecroTalk.`
- Do not expose internal token names or AST node names in error messages shown to users.
- The `NecroTalkError` type in `errors.ts` must carry `line`, `column`, and `message`.

## Property-based testing targets (fast-check)

These invariants must have PBT coverage in `*.test.ts` files co-located with the interpreter modules:

1. **Parse → print → parse round-trip**: any valid NecroTalk script printed back to text re-parses to an
   identical AST.
2. **`put`/read invariant**: `put X into it` followed by reading `it` always returns `X`.
3. **Navigation range invariant**: after any sequence of `go` commands, the current card index is always in
   `[0, stack.cards.length - 1]`.
4. **Serialization round-trip**: stack JSON serialized and deserialized is identity (tested via model, but
   interpreter must not break the JSON shape of scripts).

## Message-passing order

Object script → card script → background script → stack script.
If a handler is found, it runs and the message stops unless the handler explicitly passes it with `pass <handlerName>`.
Do not deviate from this order.
