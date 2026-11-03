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
    expect(h.name).toBe('mouseup');
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
    expect((stmt.object.name as LiteralExpression).value).toBe('Answer');
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
    expect(stmt.handlerName).toBe('mouseup');
  });
});

describe('parser — error cases', () => {
  it('throws on unknown command', () => {
    expect(() => parse('on h\n  sort\nend h')).toThrow(NecroTalkError);
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
const identArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,7}$/)
  .filter(s => !KEYWORDS.has(s.toLowerCase()))
  .map(s => s.toLowerCase());

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

// ObjectRef: every type; names are string literals or variables (what the parser produces).
const refNameArb: fc.Arbitrary<ExpressionNode> = fc.oneof(
  safeStrArb.map(v => ({ kind: 'literal' as const, value: v })),
  variableArb,
);
const objRefArb: fc.Arbitrary<ObjectRef> = fc.oneof(
  fc.record({ type: fc.constantFrom('button' as const, 'field' as const, 'image' as const), name: refNameArb }),
  fc.record({
    type: fc.constantFrom('card' as const, 'background' as const, 'stack' as const),
    name: safeStrArb.map(v => ({ kind: 'literal' as const, value: v })),
  }),
  fc.constantFrom<ObjectRef>({ type: 'card' }, { type: 'background' }, { type: 'stack' }, { type: 'me' }),
);

// Recursive expression arbitrary covering all eight expression kinds.
const { expr: exprArb } = fc.letrec<{ expr: ExpressionNode }>(tie => ({
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
      fc.record({ kind: fc.constant('property' as const), property: identArb, object: objRefArb }),
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
  ),
})) as { expr: fc.Arbitrary<ExpressionNode> };

// Containers: field containers always use a type:'field' ObjectRef.
const containerArb: fc.Arbitrary<ContainerNode> = fc.oneof(
  refNameArb.map(name => ({ kind: 'field' as const, ref: { type: 'field' as const, name } })),
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
    identArb.map<StatementNode>(target => ({ kind: 'exit', target, line: 0 })),
  ),
  fc.constant<StatementNode>({ kind: 'nextRepeat', line: 0 }),
  identArb.map<StatementNode>(handlerName => ({ kind: 'pass', handlerName, line: 0 })),
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
      name: identArb,
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
