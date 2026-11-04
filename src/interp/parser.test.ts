import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parse, print, stripPositions } from './parser.js';
import { NecroTalkError } from './errors.js';
import { KEYWORDS } from './tokenizer.js';
import type {
  ScriptNode, HandlerNode, StatementNode, ExpressionNode,
  GoStatement, IfStatement, RepeatStatement, RepeatVariant,
  PutStatement, GetStatement, SetStatement, GlobalStatement,
  AnswerStatement, AskStatement, ShowStatement, HideStatement,
  VisualEffectStatement, ExitStatement, NextRepeatStatement, PassStatement,
  BinaryExpression, LiteralExpression,
  ChunkExpression, CountExpression, FunctionCallExpression, PropertyExpression,
  ObjectRef, ContainerNode, BinaryOp,
} from './ast.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseOne(src: string): HandlerNode {
  const script = parse(src);
  expect(script.handlers).toHaveLength(1);
  return script.handlers[0];
}

function firstStmt(src: string): StatementNode {
  return parseOne(src).body[0];
}

// ---------------------------------------------------------------------------
// Task 3: Structure and simple statements
// ---------------------------------------------------------------------------

describe('parser — handler structure', () => {
  it('parses a minimal handler', () => {
    const h = parseOne('on mouseUp\n  beep\nend mouseUp');
    expect(h.name).toBe('mouseUp');
    expect(h.body).toHaveLength(1);
    expect(h.body[0].kind).toBe('beep');
  });

  it('parses handler with params', () => {
    const h = parseOne('on doIt x, y\n  beep\nend doIt');
    expect(h.params).toEqual(['x', 'y']);
  });

  it('parses multiple handlers', () => {
    const script = parse('on mouseUp\n  beep\nend mouseUp\non openCard\n  beep\nend openCard');
    expect(script.handlers).toHaveLength(2);
  });

  it('throws on missing end', () => {
    expect(() => parse('on mouseUp\n  beep')).toThrow(NecroTalkError);
  });

  it('throws on wrong end name', () => {
    expect(() => parse('on mouseUp\n  beep\nend openCard')).toThrow(NecroTalkError);
  });

  it('throws on unexpected EOF inside handler', () => {
    expect(() => parse('on mouseUp\n  if true then\n')).toThrow(NecroTalkError);
  });
});

describe('parser — go statements', () => {
  it('parses go next/prev/first/last', () => {
    for (const dir of ['next', 'prev', 'first', 'last']) {
      const stmt = firstStmt(`on h\n  go ${dir}\nend h`) as GoStatement;
      expect(stmt.kind).toBe('go');
      expect(stmt.target.type).toBe(dir);
    }
  });

  it('parses go to card N', () => {
    const stmt = firstStmt('on h\n  go to card 3\nend h') as GoStatement;
    expect(stmt.target).toEqual({ type: 'card', value: 3 });
  });

  it('parses go to card "Name"', () => {
    const stmt = firstStmt('on h\n  go to card "Home"\nend h') as GoStatement;
    expect(stmt.target).toEqual({ type: 'card', value: 'Home' });
  });

  it('assigns correct line number', () => {
    const stmt = firstStmt('on h\n  go next\nend h') as GoStatement;
    expect(stmt.line).toBe(2);
  });
});

describe('parser — put and get', () => {
  it('parses put into it', () => {
    const stmt = firstStmt('on h\n  put "hello" into it\nend h') as PutStatement;
    expect(stmt.kind).toBe('put');
    expect(stmt.mode).toBe('into');
    expect(stmt.target).toEqual({ kind: 'it' });
  });

  it('parses put before/after variable', () => {
    const b = firstStmt('on h\n  put "x" before myVar\nend h') as PutStatement;
    expect(b.mode).toBe('before');
    const a = firstStmt('on h\n  put "x" after myVar\nend h') as PutStatement;
    expect(a.mode).toBe('after');
  });

  it('parses put into field', () => {
    const stmt = firstStmt('on h\n  put "hi" into field "Name"\nend h') as PutStatement;
    expect(stmt.target).toMatchObject({ kind: 'field', ref: { type: 'field' } });
  });

  it('parses get', () => {
    const stmt = firstStmt('on h\n  get 42\nend h') as GetStatement;
    expect(stmt.kind).toBe('get');
  });
});

describe('parser — show/hide', () => {
  it('parses show field "Name"', () => {
    const stmt = firstStmt('on h\n  show field "Answer"\nend h') as ShowStatement;
    expect(stmt.kind).toBe('show');
    expect(stmt.object.type).toBe('field');
    if (stmt.object.type !== 'me') expect((stmt.object.name as LiteralExpression).value).toBe('Answer');
  });

  it('parses hide button "OK"', () => {
    const stmt = firstStmt('on h\n  hide button "OK"\nend h') as HideStatement;
    expect(stmt.object.type).toBe('button');
  });

  it('parses show me', () => {
    const stmt = firstStmt('on h\n  show me\nend h') as ShowStatement;
    expect(stmt.object.type).toBe('me');
  });
});

describe('parser — exit/next/pass', () => {
  it('parses exit repeat', () => {
    const stmt = firstStmt('on h\n  exit repeat\nend h') as ExitStatement;
    expect(stmt.target).toBe('repeat');
  });

  it('parses exit handler', () => {
    const stmt = firstStmt('on h\n  exit h\nend h') as ExitStatement;
    expect(stmt.target).toBe('h');
  });

  it('parses next repeat', () => {
    const stmt = firstStmt('on h\n  next repeat\nend h') as NextRepeatStatement;
    expect(stmt.kind).toBe('nextRepeat');
  });

  it('parses pass', () => {
    const stmt = firstStmt('on h\n  pass mouseUp\nend h') as PassStatement;
    expect(stmt.handlerName).toBe('mouseUp');
  });
});

describe('parser — error cases', () => {
  it('rejects sort with the steering message', () => {
    expect(() => parse('on h\n  sort\nend h')).toThrow('Line 2: Unknown command "sort". NecroTalk does not support sort.');
  });

  it('rejects do with the steering message', () => {
    expect(() => parse('on h\n  do "beep"\nend h')).toThrow('Line 2: "do" is not allowed in NecroTalk.');
  });

  it('throws on missing end if', () => {
    expect(() => parse('on h\n  if true then\n    beep\nend h')).toThrow(NecroTalkError);
  });
});

// ---------------------------------------------------------------------------
// Task 4: Control flow
// ---------------------------------------------------------------------------

describe('parser — if', () => {
  it('parses single-line if', () => {
    const stmt = firstStmt('on h\n  if true then beep\nend h') as IfStatement;
    expect(stmt.kind).toBe('if');
    expect(stmt.thenBranch).toHaveLength(1);
    expect(stmt.thenBranch[0].kind).toBe('beep');
    expect(stmt.elseBranch).toBeUndefined();
  });

  it('parses multi-line if with else', () => {
    const src = 'on h\n  if x = 1 then\n    beep\n  else\n    beep\n  end if\nend h';
    const stmt = firstStmt(src) as IfStatement;
    expect(stmt.thenBranch).toHaveLength(1);
    expect(stmt.elseBranch).toHaveLength(1);
  });

  it('parses else if as nested IfStatement in elseBranch', () => {
    const src = 'on h\n  if x = 1 then\n    beep\n  else if x = 2 then\n    beep\n  end if\nend h';
    const stmt = firstStmt(src) as IfStatement;
    expect(stmt.elseBranch).toHaveLength(1);
    expect(stmt.elseBranch![0].kind).toBe('if');
  });

  it('parses nested if inside repeat', () => {
    const src = 'on h\n  repeat 3 times\n    if true then beep\n  end repeat\nend h';
    const repeat = firstStmt(src) as RepeatStatement;
    expect(repeat.body[0].kind).toBe('if');
  });
});

describe('parser — repeat', () => {
  it('parses repeat N times', () => {
    const stmt = firstStmt('on h\n  repeat 3 times\n    beep\n  end repeat\nend h') as RepeatStatement;
    expect(stmt.variant.type).toBe('times');
  });

  it('parses repeat with var = a to b', () => {
    const stmt = firstStmt('on h\n  repeat with i = 1 to 5\n    beep\n  end repeat\nend h') as RepeatStatement;
    expect(stmt.variant.type).toBe('with');
    if (stmt.variant.type === 'with') expect(stmt.variant.varName).toBe('i');
  });

  it('parses repeat while expr', () => {
    const stmt = firstStmt('on h\n  repeat while x > 0\n    beep\n  end repeat\nend h') as RepeatStatement;
    expect(stmt.variant.type).toBe('while');
  });

  it('throws on repeat without end repeat', () => {
    expect(() => parse('on h\n  repeat 3 times\n    beep\nend h')).toThrow(NecroTalkError);
  });
});

// ---------------------------------------------------------------------------
// Task 5: Expressions
// ---------------------------------------------------------------------------

describe('parser — expressions', () => {
  function expr(src: string): ExpressionNode {
    const stmt = firstStmt(`on h\n  get ${src}\nend h`) as GetStatement;
    return stmt.value;
  }

  it('parses integer literal', () => {
    expect(expr('42')).toEqual({ kind: 'literal', value: 42 });
  });

  it('parses string literal', () => {
    expect(expr('"hello"')).toEqual({ kind: 'literal', value: 'hello' });
  });

  it('parses true/false', () => {
    expect(expr('true')).toEqual({ kind: 'literal', value: true });
    expect(expr('false')).toEqual({ kind: 'literal', value: false });
  });

  it('parses variable', () => {
    expect(expr('myVar')).toEqual({ kind: 'variable', name: 'myvar' });
  });

  it('parses 1 + 2 * 3 with correct precedence', () => {
    const e = expr('1 + 2 * 3') as BinaryExpression;
    expect(e.op).toBe('+');
    expect(e.right).toMatchObject({ kind: 'binary', op: '*' });
  });

  it('parses string concatenation precedence', () => {
    const e = expr('"a" & "b" && "c"') as BinaryExpression;
    // & and && have same precedence, left-assoc: ((a & b) && c)
    expect(e.op).toBe('&&');
    expect(e.left).toMatchObject({ kind: 'binary', op: '&' });
  });

  it('parses comparison with or', () => {
    const e = expr('x = 5 or y > 10') as BinaryExpression;
    expect(e.op).toBe('or');
  });

  it('parses not with parentheses', () => {
    const e = expr('not (a and b)');
    expect(e).toMatchObject({ kind: 'unary', op: 'not' });
  });

  it('parses function call', () => {
    const e = expr('random(100)') as FunctionCallExpression;
    expect(e.kind).toBe('functionCall');
    expect(e.name).toBe('random');
    expect(e.args).toHaveLength(1);
  });

  it('parses the date', () => {
    const e = expr('the date') as PropertyExpression;
    expect(e.property).toBe('date');
    expect(e.object).toBeUndefined();
  });

  it('parses word N of expr', () => {
    const e = expr('word 1 of "hello world"') as ChunkExpression;
    expect(e.chunkType).toBe('word');
  });

  it('parses the number of cards', () => {
    const e = expr('the number of cards') as CountExpression;
    expect(e.kind).toBe('count');
    expect(e.what).toBe('cards');
  });

  it('parses the number of words of expr', () => {
    const e = expr('the number of words of myText') as CountExpression;
    expect(e.what).toBe('words');
    expect(e.source).toBeDefined();
  });

  it('parses is not operator', () => {
    const e = expr('x is not y') as BinaryExpression;
    expect(e.op).toBe('is not');
  });
});

// ---------------------------------------------------------------------------
// Task 6: Remaining statements
// ---------------------------------------------------------------------------

describe('parser — visual effect', () => {
  it('parses all visual effects', () => {
    const effects = ['dissolve', 'wipe left', 'wipe right', 'scroll up'] as const;
    for (const effect of effects) {
      const stmt = firstStmt(`on h\n  visual effect ${effect}\nend h`) as VisualEffectStatement;
      expect(stmt.effect).toBe(effect);
    }
  });
});

describe('parser — set', () => {
  it('parses set property of object to value', () => {
    const stmt = firstStmt('on h\n  set visible of button "OK" to true\nend h') as SetStatement;
    expect(stmt.kind).toBe('set');
    expect(stmt.property).toBe('visible');
    expect(stmt.object.type).toBe('button');
    expect(stmt.value).toMatchObject({ kind: 'literal', value: true });
  });
});

describe('parser — global', () => {
  it('parses global varName', () => {
    const stmt = firstStmt('on h\n  global score\nend h') as GlobalStatement;
    expect(stmt.varName).toBe('score');
  });
});

describe('parser — answer', () => {
  it('parses answer without with → buttons: ["OK"]', () => {
    const stmt = firstStmt('on h\n  answer "Sure?"\nend h') as AnswerStatement;
    expect(stmt.buttons).toEqual(['OK']);
  });

  it('parses answer with buttons', () => {
    const stmt = firstStmt('on h\n  answer "Sure?" with "Yes" or "No"\nend h') as AnswerStatement;
    expect(stmt.buttons).toEqual(['Yes', 'No']);
  });
});

describe('parser — ask', () => {
  it('parses ask without default', () => {
    const stmt = firstStmt('on h\n  ask "Name?"\nend h') as AskStatement;
    expect(stmt.default).toBeUndefined();
  });

  it('parses ask with default', () => {
    const stmt = firstStmt('on h\n  ask "Name?" with "World"\nend h') as AskStatement;
    expect(stmt.default).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Task 7: Printer
// ---------------------------------------------------------------------------

describe('play statement (necrotalk-play)', () => {
  const play = (src: string) => firstStmt(`on h\n  ${src}\nend h`);

  it('parses play stop', () => {
    const s = play('play stop');
    expect(s).toMatchObject({ kind: 'play', action: 'stop' });
    expect('notes' in s && s.notes).toBeFalsy();
  });

  it('parses play with a notes string and no tempo', () => {
    const s = play('play "c e g"');
    expect(s.kind).toBe('play');
    if (s.kind !== 'play') return;
    expect(s.action).toBe('notes');
    expect(s.tempo).toBeUndefined();
    expect(s.notes).toMatchObject({ kind: 'literal', value: 'c e g' });
  });

  it('parses play tempo <expr> <expr>', () => {
    const s = play('play tempo 160 "c e g"');
    expect(s.kind).toBe('play');
    if (s.kind !== 'play') return;
    expect(s.tempo).toMatchObject({ kind: 'literal', value: 160 });
    expect(s.notes).toMatchObject({ kind: 'literal', value: 'c e g' });
  });

  it('the notes operand is a full expression (a variable)', () => {
    const s = play('play theTune');
    if (s.kind !== 'play') throw new Error('not a play');
    expect(s.notes).toMatchObject({ kind: 'variable', name: 'thetune' });
  });

  it('play with no operand is a parse error', () => {
    expect(() => parse('on h\n  play\nend h')).toThrow(NecroTalkError);
  });

  it('play tempo with no notes operand is a parse error', () => {
    expect(() => parse('on h\n  play tempo 160\nend h')).toThrow(NecroTalkError);
  });

  it('round-trips each form through print', () => {
    for (const src of ['play stop', 'play "c e g"', 'play tempo 160 "c e g"', 'play theTune']) {
      const script = parse(`on h\n  ${src}\nend h\n`);
      expect(stripPositions(parse(print(script)))).toEqual(stripPositions(script));
    }
  });
});

describe('printer — basic', () => {
  it('prints a simple beep handler', () => {
    const script = parse('on mouseUp\n  beep\nend mouseUp\n');
    const printed = print(script);
    const reparsed = parse(printed);
    expect(stripPositions(reparsed)).toEqual(stripPositions(script));
  });

  it('prints if/repeat with correct indentation', () => {
    const src = 'on h\n  if x = 1 then\n    repeat 3 times\n      beep\n    end repeat\n  end if\nend h\n';
    const script = parse(src);
    const printed = print(script);
    expect(printed).toContain('if');
    expect(printed).toContain('repeat');
    const reparsed = parse(printed);
    expect(stripPositions(reparsed)).toEqual(stripPositions(script));
  });

  it('prints else if sugar correctly', () => {
    const src = 'on h\n  if x = 1 then\n    beep\n  else if x = 2 then\n    beep\n  end if\nend h\n';
    const script = parse(src);
    const printed = print(script);
    expect(printed).toContain('else if');
    expect(printed).not.toMatch(/else\s*\n\s*if/);
  });

  it('parenthesizes correctly: (a + b) * c', () => {
    const src = 'on h\n  get (a + b) * c\nend h\n';
    const script = parse(src);
    const printed = print(script);
    expect(printed).toContain('(');
    const reparsed = parse(printed);
    expect(stripPositions(reparsed)).toEqual(stripPositions(script));
  });

  it('parenthesizes correctly: a - (b - c)', () => {
    const src = 'on h\n  get a - (b - c)\nend h\n';
    const script = parse(src);
    const printed = print(script);
    const reparsed = parse(printed);
    expect(stripPositions(reparsed)).toEqual(stripPositions(script));
  });
});

describe('stripPositions', () => {
  it('sets all statement line fields to 0', () => {
    const script = parse('on h\n  beep\nend h\n');
    const stripped = stripPositions(script);
    expect(stripped.handlers[0].body[0].line).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Printer — unary / chunk / count parenthesization (regressions found while
// widening the round-trip arbitrary)
// ---------------------------------------------------------------------------

describe('printer — unary and chunk parenthesization', () => {
  const roundTrip = (body: string) => {
    const script = parse(`on h\n  get ${body}\nend h\n`);
    expect(stripPositions(parse(print(script)))).toEqual(stripPositions(script));
  };

  it('not (a and b) keeps its grouping', () => roundTrip('not (a and b)'));
  it('(not a) = b keeps its grouping', () => roundTrip('(not a) = b'));
  it('a is (not b) is not confused with "is not"', () => roundTrip('a is (not b)'));
  it('-(-b) does not print as a "--" comment', () => roundTrip('-(-b)'));
  it('-(a + b) keeps its grouping', () => roundTrip('-(a + b)'));
  it('word (a + 1) of (x & y) keeps its grouping', () => roundTrip('word (a + 1) of (x & y)'));
  it('(the number of words of x) * 2 keeps its grouping', () => roundTrip('the number of words of x * 2'));
  it('(a ^ b) ^ c keeps its grouping (right-associative ^)', () => roundTrip('(a ^ b) ^ c'));
  it('a ^ b ^ c stays right-nested without parens', () => {
    const script = parse('on h\n  get a ^ b ^ c\nend h\n');
    expect(print(script)).toContain('get a ^ b ^ c');
  });
});

// ---------------------------------------------------------------------------
// Task 8: PBT — parse → print → parse round-trip
// Covers every statement type and every expression type in REQ-1.
// ---------------------------------------------------------------------------

// Identifiers: [A-Za-z_][A-Za-z0-9_]*, not a keyword. Stored lowercased in the AST.
// Names exactly as written: [A-Za-z_][A-Za-z0-9_]*, not a reserved word.
// Handler, call, pass and exit names keep their case in the AST.
const nameArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,7}$/)
  .filter(s => !KEYWORDS.has(s.toLowerCase()));

// Variable names are stored lowercased in the AST.
const identArb: fc.Arbitrary<string> = nameArb.map(s => s.toLowerCase());

// String literals: Unicode graphemes, excluding `"`, `\n`, `\r` (no escapes in NecroTalk).
const safeStrArb: fc.Arbitrary<string> = fc
  .string({ unit: 'grapheme', maxLength: 20 })
  .filter(s => !s.includes('"') && !s.includes('\n') && !s.includes('\r'));

// Number literals: non-negative, finite, plain decimal notation (integers and 2-place decimals).
const safeNumArb: fc.Arbitrary<number> = fc.oneof(
  fc.nat({ max: 99999 }),
  fc.nat({ max: 99999 }).map(n => n / 100),
);

const literalArb: fc.Arbitrary<ExpressionNode> = fc.oneof(
  safeStrArb.map(v => ({ kind: 'literal' as const, value: v })),
  safeNumArb.map(v => ({ kind: 'literal' as const, value: v })),
  fc.boolean().map(v => ({ kind: 'literal' as const, value: v })),
);

const variableArb: fc.Arbitrary<ExpressionNode> =
  identArb.map(name => ({ kind: 'variable' as const, name }));

const allBinaryOps: BinaryOp[] = [
  '+', '-', '*', '/', 'mod', '^',
  '=', '<>', '<', '>', '<=', '>=', 'is', 'is not', 'contains',
  'and', 'or', '&', '&&',
];

// Recursive expression + object-reference arbitraries covering all nine expression
// kinds. Object names are any expression, so refs and expressions are mutually recursive.
const { expr: exprArb, objRef: objRefArb } = fc.letrec<{ expr: ExpressionNode; objRef: ObjectRef }>(tie => ({
  objRef: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.constant<ObjectRef>({ type: 'me' }),
    fc.record({
      type: fc.constantFrom('button' as const, 'field' as const, 'image' as const, 'card' as const),
      name: tie('expr'),
    }),
  ),
  expr: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    literalArb,
    variableArb,
    fc.record({
      kind: fc.constant('binary' as const),
      op: fc.constantFrom(...allBinaryOps),
      left: tie('expr'),
      right: tie('expr'),
    }),
    fc.record({ kind: fc.constant('unary' as const), op: fc.constantFrom('not' as const, '-' as const), operand: tie('expr') }),
    fc.record({
      kind: fc.constant('functionCall' as const),
      name: fc.oneof(fc.constantFrom('random', 'length'), identArb),
      args: fc.array(tie('expr'), { maxLength: 2 }),
    }),
    fc.oneof(
      identArb.map(property => ({ kind: 'property' as const, property })),
      fc.record({ kind: fc.constant('property' as const), property: identArb, object: tie('objRef') }),
    ),
    fc.record({
      kind: fc.constant('chunk' as const),
      chunkType: fc.constantFrom('word' as const, 'line' as const, 'char' as const),
      index: tie('expr'),
      source: tie('expr'),
    }),
    fc.oneof(
      fc.constant({ kind: 'count' as const, what: 'cards' as const }),
      fc.record({
        kind: fc.constant('count' as const),
        what: fc.constantFrom('words' as const, 'lines' as const, 'chars' as const),
        source: tie('expr'),
      }),
    ),
    tie('expr').map(name => ({ kind: 'field' as const, ref: { type: 'field' as const, name } })),
  ),
})) as { expr: fc.Arbitrary<ExpressionNode>; objRef: fc.Arbitrary<ObjectRef> };

// Containers: field containers always use a type:'field' ObjectRef.
const containerArb: fc.Arbitrary<ContainerNode> = fc.oneof(
  exprArb.map(name => ({ kind: 'field' as const, ref: { type: 'field' as const, name } })),
  identArb.map(name => ({ kind: 'variable' as const, name })),
  fc.constant({ kind: 'it' as const }),
);

const goTargetArb: fc.Arbitrary<GoStatement['target']> = fc.oneof(
  fc.constantFrom<GoStatement['target']>({ type: 'next' }, { type: 'prev' }, { type: 'first' }, { type: 'last' }),
  fc.integer({ min: 1, max: 99 }).map(value => ({ type: 'card' as const, value })),
  safeStrArb.map(value => ({ type: 'card' as const, value })),
);

// Every non-compound statement kind.
const simpleStmts: fc.Arbitrary<StatementNode>[] = [
  fc.constant<StatementNode>({ kind: 'beep', line: 0 }),
  goTargetArb.map(target => ({ kind: 'go' as const, target, line: 0 })),
  fc.constantFrom('dissolve', 'wipe left', 'wipe right', 'scroll up' as const)
    .map(effect => ({ kind: 'visualEffect' as const, effect: effect as VisualEffectStatement['effect'], line: 0 })),
  fc.record({
    kind: fc.constant('put' as const),
    value: exprArb,
    mode: fc.constantFrom('into' as const, 'before' as const, 'after' as const),
    target: containerArb,
    line: fc.constant(0),
  }),
  fc.record({ kind: fc.constant('get' as const), value: exprArb, line: fc.constant(0) }),
  fc.record({ kind: fc.constant('set' as const), property: identArb, object: objRefArb, value: exprArb, line: fc.constant(0) }),
  identArb.map(varName => ({ kind: 'global' as const, varName, line: 0 })),
  fc.record({
    kind: fc.constant('answer' as const),
    prompt: exprArb,
    buttons: fc.oneof(fc.constant<string[]>(['OK']), fc.array(safeStrArb, { minLength: 1, maxLength: 3 })),
    line: fc.constant(0),
  }),
  fc.record(
    { kind: fc.constant('ask' as const), prompt: exprArb, default: exprArb, line: fc.constant(0) },
    { requiredKeys: ['kind', 'prompt', 'line'] },
  ),
  fc.record({ kind: fc.constantFrom('show' as const, 'hide' as const), object: objRefArb, line: fc.constant(0) }),
  fc.oneof(
    fc.constant<StatementNode>({ kind: 'exit', target: 'repeat', line: 0 }),
    nameArb.map<StatementNode>(target => ({ kind: 'exit', target, line: 0 })),
  ),
  fc.constant<StatementNode>({ kind: 'nextRepeat', line: 0 }),
  nameArb.map<StatementNode>(handlerName => ({ kind: 'pass', handlerName, line: 0 })),
  fc.record({
    kind: fc.constant('call' as const),
    // `do` and `sort` are rejected by the parser as out-of-scope commands
    name: nameArb.filter(n => !['do', 'sort'].includes(n.toLowerCase())),
    args: fc.array(exprArb, { maxLength: 3 }),
    line: fc.constant(0),
  }),
];
const simpleStmtArb: fc.Arbitrary<StatementNode> = fc.oneof(...simpleStmts);

const repeatVariantArb: fc.Arbitrary<RepeatVariant> = fc.oneof(
  exprArb.map(count => ({ type: 'times' as const, count })),
  fc.record({ type: fc.constant('with' as const), varName: identArb, from: exprArb, to: exprArb }),
  exprArb.map(condition => ({ type: 'while' as const, condition })),
);

// Compound statements nest simple statements and each other (if inside repeat, etc.).
const { stmt: stmtArb } = fc.letrec<{ stmt: StatementNode }>(tie => {
  const body = fc.array(tie('stmt'), { minLength: 1, maxLength: 3 });
  return {
    stmt: fc.oneof(
      { depthSize: 'small', withCrossShrink: true },
      simpleStmtArb,
      fc.record(
        { kind: fc.constant('if' as const), condition: exprArb, thenBranch: body, elseBranch: body, line: fc.constant(0) },
        { requiredKeys: ['kind', 'condition', 'thenBranch', 'line'] },
      ),
      fc.record({ kind: fc.constant('repeat' as const), variant: repeatVariantArb, body, line: fc.constant(0) }),
    ),
  };
}) as { stmt: fc.Arbitrary<StatementNode> };

const scriptArb: fc.Arbitrary<ScriptNode> = fc.record({
  kind: fc.constant('script' as const),
  handlers: fc.array(
    fc.record({
      kind: fc.constant('handler' as const),
      name: nameArb,
      params: fc.array(identArb, { maxLength: 3 }),
      body: fc.array(stmtArb, { minLength: 1, maxLength: 5 }),
    }),
    { minLength: 1, maxLength: 3 },
  ),
});

describe('PBT — parse → print → parse round-trip', () => {
  it('printed AST re-parses to an identical AST (200 runs)', () => {
    fc.assert(
      fc.property(scriptArb, script => {
        const reparsed = parse(print(script));
        expect(stripPositions(reparsed)).toEqual(stripPositions(script));
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Regression: custom handler calls and else-if chains (necrotalk-reviewer findings)
// ---------------------------------------------------------------------------

describe('regression — custom handler call statements', () => {
  it('parses a bare call', () => {
    const stmt = firstStmt('on h\n  checkAnswer\nend h');
    expect(stmt).toEqual({ kind: 'call', name: 'checkAnswer', args: [], line: 2 });
  });

  it('parses a call with comma-separated args', () => {
    const stmt = firstStmt('on h\n  addScore 10, "bonus", x + 1\nend h');
    expect(stmt.kind).toBe('call');
    if (stmt.kind === 'call') {
      expect(stmt.args).toHaveLength(3);
      expect(stmt.args[2]).toMatchObject({ kind: 'binary', op: '+' });
    }
  });

  it('round-trips a call through the printer', () => {
    const script = parse('on h\n  addScore 10, "bonus"\nend h\n');
    expect(stripPositions(parse(print(script)))).toEqual(stripPositions(script));
  });
});

describe('regression — single-line else if inside a multi-line block', () => {
  it('requires the outer end if', () => {
    // Before the fix, the single-line `else if` ended the block early and the
    // missing `end if` was accepted.
    const src = 'on h\n  if a then\n    beep\n  else if b then beep\nend h';
    expect(() => parse(src)).toThrow(NecroTalkError);
  });

  it('accepts the block when end if is present', () => {
    const src = 'on h\n  if a then\n    beep\n  else if b then beep\n  end if\n  beep\nend h';
    const h = parseOne(src);
    expect(h.body).toHaveLength(2);
    const outer = h.body[0] as IfStatement;
    expect(outer.elseBranch).toHaveLength(1);
    const inner = outer.elseBranch![0] as IfStatement;
    expect(inner.kind).toBe('if');
    expect(inner.thenBranch).toEqual([{ kind: 'beep', line: 4 }]);
    expect(h.body[1].kind).toBe('beep');
  });

  it('supports a further else after a single-line else if', () => {
    const src = 'on h\n  if a then\n    beep\n  else if b then beep\n  else\n    beep\n  end if\nend h';
    const outer = parseOne(src).body[0] as IfStatement;
    const inner = outer.elseBranch![0] as IfStatement;
    expect(inner.elseBranch).toEqual([{ kind: 'beep', line: 6 }]);
  });

  it('a standalone single-line if still needs no end if', () => {
    const h = parseOne('on h\n  if a then beep\n  beep\nend h');
    expect(h.body).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Regression: second necrotalk-reviewer pass
// ---------------------------------------------------------------------------

describe('regression — set [the] <property>', () => {
  it('parses set with the optional "the"', () => {
    const withThe = firstStmt('on h\n  set the visible of button "OK" to true\nend h') as SetStatement;
    const without = firstStmt('on h\n  set visible of button "OK" to true\nend h') as SetStatement;
    expect(withThe).toEqual(without);
    expect(withThe.property).toBe('visible');
  });
});

describe('regression — field reads in expressions', () => {
  it('parses field "Score" + 1 as (field "Score") + 1', () => {
    const stmt = firstStmt('on h\n  put field "Score" + 1 into field "Score"\nend h') as PutStatement;
    expect(stmt.value).toEqual({
      kind: 'binary', op: '+',
      left: { kind: 'field', ref: { type: 'field', name: { kind: 'literal', value: 'Score' } } },
      right: { kind: 'literal', value: 1 },
    });
  });

  it('field reads work as chunk sources and conditions', () => {
    const stmt = firstStmt('on h\n  if word 1 of field "A" is "x" then beep\nend h') as IfStatement;
    expect(stmt.condition).toMatchObject({ kind: 'binary', op: 'is', left: { kind: 'chunk', source: { kind: 'field' } } });
  });

  it('round-trips a field read with a compound name', () => {
    const script = parse('on h\n  get field ("A" & n) & "!"\nend h\n');
    expect(stripPositions(parse(print(script)))).toEqual(stripPositions(script));
  });
});

describe('regression — object reference restrictions', () => {
  it('a variable is a valid object name', () => {
    const stmt = firstStmt('on h\n  show button x\nend h') as ShowStatement;
    expect(stmt.object).toEqual({ type: 'button', name: { kind: 'variable', name: 'x' } });
  });

  it('background and stack references are parse errors', () => {
    expect(() => parse('on h\n  show background "B"\nend h'))
      .toThrow('Line 2: "background" references are not supported in NecroTalk.');
    expect(() => parse('on h\n  put the name of stack "S" into x\nend h'))
      .toThrow('Line 2: "stack" references are not supported in NecroTalk.');
  });

  it('nameless references other than me are parse errors', () => {
    expect(() => parse('on h\n  hide field\nend h'))
      .toThrow('Line 2: Expected a name after "field" but found end of line.');
    expect(() => parse('on h\n  set visible of card to false\nend h'))
      .toThrow('Line 2: Expected a name after "card" but found "to".');
  });

  it('me takes no name', () => {
    expect(firstStmt('on h\n  hide me\nend h')).toEqual({ kind: 'hide', object: { type: 'me' }, line: 2 });
    expect(() => parse('on h\n  hide me "x"\nend h')).toThrow(NecroTalkError);
  });
});

describe('regression — answer button limit', () => {
  it('accepts three buttons', () => {
    const stmt = firstStmt('on h\n  answer "?" with "A" or "B" or "C"\nend h') as AnswerStatement;
    expect(stmt.buttons).toEqual(['A', 'B', 'C']);
  });

  it('rejects a fourth button', () => {
    expect(() => parse('on h\n  answer "?" with "A" or "B" or "C" or "D"\nend h'))
      .toThrow('Line 2: "answer" accepts at most three buttons.');
  });
});

describe('regression — reserved words cannot be names', () => {
  const cases: [string, string][] = [
    ['put target', 'on h\n  put 1 into card\nend h'],
    ['handler name', 'on next\n  beep\nend next'],
    ['parameter', 'on h number\n  beep\nend h'],
    ['global', 'on h\n  global line\nend h'],
    ['repeat with', 'on h\n  repeat with word = 1 to 2\n    beep\n  end repeat\nend h'],
    ['pass target', 'on h\n  pass field\nend h'],
  ];
  for (const [label, src] of cases) {
    it(`rejects a reserved word as a ${label}`, () => {
      expect(() => parse(src)).toThrow(/is a reserved word\.$/);
    });
  }

  it('names the word in the message', () => {
    expect(() => parse('on h\n  put 1 into card\nend h')).toThrow('Line 2: "card" is a reserved word.');
  });
});

describe('regression — error message wording', () => {
  it('a newline in a "found" clause reads "end of line"', () => {
    expect(() => parse('on h\n  go to\nend h')).toThrow('Line 2: Expected "card" but found end of line.');
  });

  it('end of input in a "found" clause reads "end of script"', () => {
    expect(() => parse('on h\n  put 1 into'))
      .toThrow('Line 2: Expected a container (field, variable, or "it") but found end of script.');
  });

  it('messages contain no raw line breaks', () => {
    try {
      parse('on h\n  put 1\nend h');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as NecroTalkError).message).not.toMatch(/\n/);
    }
  });

  it('handler names keep their original case in messages', () => {
    expect(() => parse('on mouseUp\n  beep\nend click'))
      .toThrow('Line 3: Expected "end mouseUp" but found "end click".');
  });

  it('handler name matching stays case-insensitive', () => {
    expect(parseOne('on mouseUp\n  beep\nEND MOUSEUP').name).toBe('mouseUp');
  });
});

describe('regression — third reviewer pass: end-of-line / end-of-script wording', () => {
  it('unknown visual effect at end of line', () => {
    expect(() => parse('on h\n  visual effect\nend h'))
      .toThrow('Line 2: Unknown visual effect end of line.');
  });

  it('unknown visual effect names the word', () => {
    expect(() => parse('on h\n  visual effect zoom\nend h'))
      .toThrow('Line 2: Unknown visual effect "zoom".');
  });

  it('missing end if at end of input reads "end of script"', () => {
    expect(() => parse('on h\n  if a then\n    beep'))
      .toThrow('Expected "end if" but found end of script.');
  });

  it('missing end repeat at end of input reads "end of script"', () => {
    expect(() => parse('on h\n  repeat 2 times\n    beep'))
      .toThrow('Expected "end repeat" but found end of script.');
  });
});

describe('regression — fifth reviewer pass: reserved word read as a value', () => {
  it('put left into x reports a reserved word', () => {
    expect(() => parse('on h\n  put left into x\nend h')).toThrow('Line 2: "left" is a reserved word.');
  });

  it('get number reports a reserved word', () => {
    expect(() => parse('on h\n  get number\nend h')).toThrow('Line 2: "number" is a reserved word.');
  });
});
