import { describe, it, expect } from 'vitest';
import type {
  ScriptNode, HandlerNode, StatementNode,
  GoStatement, BeepStatement, IfStatement, RepeatStatement,
  PutStatement, GetStatement, SetStatement, GlobalStatement,
  AnswerStatement, AskStatement, ShowStatement, HideStatement,
  VisualEffectStatement, ExitStatement, NextRepeatStatement, PassStatement,
  ExpressionNode, LiteralExpression, VariableExpression, BinaryExpression,
  UnaryExpression, FunctionCallExpression, PropertyExpression,
  ChunkExpression, CountExpression,
  ObjectRef, ContainerNode, BinaryOp,
} from './ast.js';
import { NecroTalkError, formatError } from './errors.js';

describe('AST types compile and construct', () => {
  it('can construct a minimal ScriptNode', () => {
    const script: ScriptNode = {
      kind: 'script',
      handlers: [],
    };
    expect(script.kind).toBe('script');
  });

  it('can construct a HandlerNode with params', () => {
    const handler: HandlerNode = {
      kind: 'handler',
      name: 'mouseup',
      params: ['x', 'y'],
      body: [],
    };
    expect(handler.name).toBe('mouseup');
    expect(handler.params).toHaveLength(2);
  });

  it('can construct all statement node types', () => {
    const stmts: StatementNode[] = [
      { kind: 'go', target: { type: 'next' }, line: 1 } satisfies GoStatement,
      { kind: 'beep', line: 2 } satisfies BeepStatement,
      {
        kind: 'if',
        condition: { kind: 'literal', value: true },
        thenBranch: [],
        line: 3,
      } satisfies IfStatement,
      {
        kind: 'repeat',
        variant: { type: 'times', count: { kind: 'literal', value: 3 } },
        body: [],
        line: 4,
      } satisfies RepeatStatement,
      {
        kind: 'put',
        value: { kind: 'literal', value: 'hello' },
        mode: 'into',
        target: { kind: 'it' },
        line: 5,
      } satisfies PutStatement,
      { kind: 'get', value: { kind: 'literal', value: 42 }, line: 6 } satisfies GetStatement,
      {
        kind: 'set',
        property: 'visible',
        object: { type: 'button', name: { kind: 'literal', value: 'OK' } },
        value: { kind: 'literal', value: true },
        line: 7,
      } satisfies SetStatement,
      { kind: 'global', varName: 'score', line: 8 } satisfies GlobalStatement,
      {
        kind: 'answer',
        prompt: { kind: 'literal', value: 'Sure?' },
        buttons: ['Yes', 'No'],
        line: 9,
      } satisfies AnswerStatement,
      {
        kind: 'ask',
        prompt: { kind: 'literal', value: 'Name?' },
        line: 10,
      } satisfies AskStatement,
      {
        kind: 'show',
        object: { type: 'field', name: { kind: 'literal', value: 'Answer' } },
        line: 11,
      } satisfies ShowStatement,
      {
        kind: 'hide',
        object: { type: 'button', name: { kind: 'literal', value: 'Flip' } },
        line: 12,
      } satisfies HideStatement,
      { kind: 'visualEffect', effect: 'dissolve', line: 13 } satisfies VisualEffectStatement,
      { kind: 'exit', target: 'repeat', line: 14 } satisfies ExitStatement,
      { kind: 'nextRepeat', line: 15 } satisfies NextRepeatStatement,
      { kind: 'pass', handlerName: 'mouseup', line: 16 } satisfies PassStatement,
    ];
    expect(stmts).toHaveLength(16);
  });

  it('can construct all expression node types', () => {
    const exprs: ExpressionNode[] = [
      { kind: 'literal', value: 42 } satisfies LiteralExpression,
      { kind: 'literal', value: 'hello' } satisfies LiteralExpression,
      { kind: 'literal', value: true } satisfies LiteralExpression,
      { kind: 'variable', name: 'x' } satisfies VariableExpression,
      {
        kind: 'binary',
        op: '+' as BinaryOp,
        left: { kind: 'literal', value: 1 },
        right: { kind: 'literal', value: 2 },
      } satisfies BinaryExpression,
      {
        kind: 'unary',
        op: 'not',
        operand: { kind: 'literal', value: true },
      } satisfies UnaryExpression,
      {
        kind: 'functionCall',
        name: 'random',
        args: [{ kind: 'literal', value: 10 }],
      } satisfies FunctionCallExpression,
      {
        kind: 'property',
        property: 'date',
      } satisfies PropertyExpression,
      {
        kind: 'chunk',
        chunkType: 'word',
        index: { kind: 'literal', value: 1 },
        source: { kind: 'literal', value: 'hello world' },
      } satisfies ChunkExpression,
      { kind: 'count', what: 'cards' } satisfies CountExpression,
      {
        kind: 'count',
        what: 'words',
        source: { kind: 'literal', value: 'a b c' },
      } satisfies CountExpression,
    ];
    expect(exprs).toHaveLength(11);
  });

  it('can construct ObjectRef for all types', () => {
    const refs: ObjectRef[] = [
      { type: 'button', name: { kind: 'literal', value: 'OK' } },
      { type: 'field', name: { kind: 'literal', value: 'Name' } },
      { type: 'image' },
      { type: 'card' },
      { type: 'background' },
      { type: 'stack' },
      { type: 'me' },
    ];
    expect(refs).toHaveLength(7);
  });

  it('can construct ContainerNode for all kinds', () => {
    const containers: ContainerNode[] = [
      { kind: 'field', ref: { type: 'field', name: { kind: 'literal', value: 'Name' } } },
      { kind: 'variable', name: 'x' },
      { kind: 'it' },
    ];
    expect(containers).toHaveLength(3);
  });

  it('discriminated union narrows correctly on kind', () => {
    const stmt: StatementNode = { kind: 'beep', line: 1 };
    if (stmt.kind === 'beep') {
      expect(stmt.line).toBe(1);
    } else {
      throw new Error('Should have narrowed to BeepStatement');
    }
  });
});

describe('NecroTalkError', () => {
  it('constructs with message, line, and column', () => {
    const err = new NecroTalkError('Line 3: Something went wrong.', 3, 5);
    expect(err.line).toBe(3);
    expect(err.column).toBe(5);
    expect(err.message).toBe('Line 3: Something went wrong.');
    expect(err.name).toBe('NecroTalkError');
  });

  it('is an instance of Error', () => {
    const err = new NecroTalkError('Line 1: Oops.', 1, 1);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('formatError', () => {
  it('formats as "Line N: msg."', () => {
    expect(formatError(5, 1, 'Expected "end mouseUp" but found "end click"')).toBe(
      'Line 5: Expected "end mouseUp" but found "end click".'
    );
  });

  it('always appends a period', () => {
    const msg = formatError(1, 1, 'Something bad');
    expect(msg.endsWith('.')).toBe(true);
  });
});
