/**
 * NecroTalk Abstract Syntax Tree node type definitions.
 * This file contains type declarations only — no runtime logic.
 *
 * Every node uses a discriminated `kind` field for type narrowing.
 * Every statement node carries a `line` field (1-indexed source line).
 *
 * Design notes:
 * - StatementNode is a union that can grow for Phase 2 (FindStatement, PlayStatement, SendStatement).
 * - ExpressionNode is a union that can grow (item chunks → ChunkExpression.chunkType += 'item').
 * - ObjectRef is used wherever the grammar names a HyperCard object (show, hide, set, field containers).
 */

// ---------------------------------------------------------------------------
// ObjectRef — lightweight reference to a named HyperCard object
// ---------------------------------------------------------------------------

/**
 * A reference to a named object, or to `me` (the object whose script is running).
 * The name is any expression (usually a string literal); `button x` is valid.
 * `background` and `stack` references, and nameless references other than `me`,
 * are parse errors in this version.
 * Used in show/hide/set/the-property-of/field-container and field-read contexts.
 */
export type ObjectRef =
  | { type: 'button' | 'field' | 'image' | 'card'; name: ExpressionNode }
  | { type: 'me' };

// ---------------------------------------------------------------------------
// Script and handler
// ---------------------------------------------------------------------------

/** Top-level node returned by parse(). A script is a sequence of handlers. */
export interface ScriptNode {
  kind: 'script';
  handlers: HandlerNode[];
}

/** A single `on <name> [params] ... end <name>` block. */
export interface HandlerNode {
  kind: 'handler';
  /** Handler name as written in the source. Compared case-insensitively. */
  name: string;
  /** Parameter names, stored lowercased (they are variables). */
  params: string[];
  body: StatementNode[];
}

// ---------------------------------------------------------------------------
// Statement union
// ---------------------------------------------------------------------------

/** All statement node types. The union can be extended for Phase 2. */
export type StatementNode =
  | GoStatement
  | VisualEffectStatement
  | PutStatement
  | GetStatement
  | SetStatement
  | GlobalStatement
  | AnswerStatement
  | AskStatement
  | ShowStatement
  | HideStatement
  | BeepStatement
  | IfStatement
  | RepeatStatement
  | ExitStatement
  | NextRepeatStatement
  | PassStatement
  | CallStatement;

// ---------------------------------------------------------------------------
// Navigation statements
// ---------------------------------------------------------------------------

export interface GoStatement {
  kind: 'go';
  target: GoTarget;
  line: number;
}

/**
 * GoTarget variants:
 * - `{ type: 'card', value: number }` — go to card N (1-based)
 * - `{ type: 'card', value: string }` — go to card "Name"
 * - `{ type: 'next' | 'prev' | 'first' | 'last' }` — relative navigation
 */
export type GoTarget =
  | { type: 'card'; value: number | string }
  | { type: 'next' | 'prev' | 'first' | 'last' };

export interface VisualEffectStatement {
  kind: 'visualEffect';
  effect: 'dissolve' | 'wipe left' | 'wipe right' | 'scroll up';
  line: number;
}

// ---------------------------------------------------------------------------
// Data and property statements
// ---------------------------------------------------------------------------

export interface PutStatement {
  kind: 'put';
  value: ExpressionNode;
  mode: 'into' | 'before' | 'after';
  target: ContainerNode;
  line: number;
}

export interface GetStatement {
  kind: 'get';
  value: ExpressionNode;
  line: number;
}

export interface SetStatement {
  kind: 'set';
  property: string;
  object: ObjectRef;
  value: ExpressionNode;
  line: number;
}

export interface GlobalStatement {
  kind: 'global';
  varName: string;
  line: number;
}

/** `answer <prompt> [with <btn1> [or <btn2> [or <btn3>]]]`
 *  When no `with` clause, buttons defaults to ["OK"]. */
export interface AnswerStatement {
  kind: 'answer';
  prompt: ExpressionNode;
  /** Always has at least one entry. Defaults to ["OK"] when no `with` clause. */
  buttons: string[];
  line: number;
}

export interface AskStatement {
  kind: 'ask';
  prompt: ExpressionNode;
  default?: ExpressionNode;
  line: number;
}

// ---------------------------------------------------------------------------
// Visibility and feedback
// ---------------------------------------------------------------------------

export interface ShowStatement {
  kind: 'show';
  object: ObjectRef;
  line: number;
}

export interface HideStatement {
  kind: 'hide';
  object: ObjectRef;
  line: number;
}

export interface BeepStatement {
  kind: 'beep';
  line: number;
}

// ---------------------------------------------------------------------------
// Control flow
// ---------------------------------------------------------------------------

/**
 * `if <cond> then <thenBranch> [else <elseBranch>] end if`
 * `else if` sugar: elseBranch is a single IfStatement (not a new node type).
 */
export interface IfStatement {
  kind: 'if';
  condition: ExpressionNode;
  thenBranch: StatementNode[];
  elseBranch?: StatementNode[];
  line: number;
}

export interface RepeatStatement {
  kind: 'repeat';
  variant: RepeatVariant;
  body: StatementNode[];
  line: number;
}

export type RepeatVariant =
  | { type: 'times'; count: ExpressionNode }
  | { type: 'with'; varName: string; from: ExpressionNode; to: ExpressionNode }
  | { type: 'while'; condition: ExpressionNode };

/** `exit <handlerName>` or `exit repeat` */
export interface ExitStatement {
  kind: 'exit';
  /** 'repeat' or the handler name */
  target: 'repeat' | string;
  line: number;
}

export interface NextRepeatStatement {
  kind: 'nextRepeat';
  line: number;
}

export interface PassStatement {
  kind: 'pass';
  handlerName: string;
  line: number;
}

/**
 * Custom handler call: `<name> [arg, arg...]` where <name> is not a keyword.
 * Calls the handler <name> in the same script. Name is kept as written; lookup is case-insensitive.
 */
export interface CallStatement {
  kind: 'call';
  name: string;
  args: ExpressionNode[];
  line: number;
}

// ---------------------------------------------------------------------------
// Container node (put/get target)
// ---------------------------------------------------------------------------

/**
 * A container is the target of a `put` or `get` statement.
 * - kind 'field': a field object referenced by ObjectRef
 * - kind 'variable': a named local or global variable (name stored lowercased)
 * - kind 'it': the implicit `it` variable
 */
export type ContainerNode =
  | { kind: 'field'; ref: ObjectRef }
  | { kind: 'variable'; name: string }
  | { kind: 'it' };

// ---------------------------------------------------------------------------
// Expression union
// ---------------------------------------------------------------------------

/** All expression node types. The union can be extended for Phase 2. */
export type ExpressionNode =
  | LiteralExpression
  | VariableExpression
  | BinaryExpression
  | UnaryExpression
  | FunctionCallExpression
  | PropertyExpression
  | ChunkExpression
  | CountExpression
  | FieldExpression;

// ---------------------------------------------------------------------------
// Expression nodes
// ---------------------------------------------------------------------------

/**
 * A literal value: number, string, or boolean.
 * Number literals are non-negative and finite (no Infinity, NaN, scientific notation).
 * String literals may not contain `"` or newlines (no escape sequences in NecroTalk).
 */
export interface LiteralExpression {
  kind: 'literal';
  value: number | string | boolean;
}

/**
 * An unquoted identifier used as a variable reference.
 * Name is stored lowercased (case-insensitive variables).
 */
export interface VariableExpression {
  kind: 'variable';
  name: string;
}

export interface BinaryExpression {
  kind: 'binary';
  op: BinaryOp;
  left: ExpressionNode;
  right: ExpressionNode;
}

/** All binary operators. Arithmetic, comparison, logic, concatenation. */
export type BinaryOp =
  | '+' | '-' | '*' | '/' | 'mod' | '^'
  | '=' | '<>' | '<' | '>' | '<=' | '>='
  | 'is' | 'is not' | 'contains'
  | 'and' | 'or'
  | '&' | '&&';

export interface UnaryExpression {
  kind: 'unary';
  op: 'not' | '-';
  operand: ExpressionNode;
}

/** A function call: `random(N)`, `length(s)`, etc. */
export interface FunctionCallExpression {
  kind: 'functionCall';
  name: string;
  args: ExpressionNode[];
}

/**
 * A property read: `the date`, `the time`, `the <property> of <objectRef>`.
 * `object` is absent for bare property reads like `the date`.
 */
export interface PropertyExpression {
  kind: 'property';
  property: string;
  object?: ObjectRef;
}

/**
 * A chunk expression: `word N of s`, `line N of s`, `char N of s`.
 * chunkType can be extended with 'item' for Phase 2.
 */
export interface ChunkExpression {
  kind: 'chunk';
  chunkType: 'word' | 'line' | 'char';
  index: ExpressionNode;
  source: ExpressionNode;
}

/**
 * `the number of cards` / `the number of words of s` / etc.
 * Replaces old "the number of ..." PropertyExpression handling.
 * `source` is absent for 'cards'.
 */
export interface CountExpression {
  kind: 'count';
  what: 'cards' | 'words' | 'lines' | 'chars';
  source?: ExpressionNode;
}

/**
 * A field reference in expression position: `field "Score"` evaluates to the field's text.
 * `ref.type` is always 'field'.
 */
export interface FieldExpression {
  kind: 'field';
  ref: { type: 'field'; name: ExpressionNode };
}
