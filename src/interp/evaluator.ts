import { NecroTalkError, formatError } from './errors.js';
import { resolveNavigation } from './navigation.js';
import type {
  ScriptNode, HandlerNode, StatementNode, ExpressionNode,
  BinaryOp, ContainerNode, ObjectRef,
} from './ast.js';

// ---------------------------------------------------------------------------
// Host interface
// ---------------------------------------------------------------------------

/**
 * An object reference as the host sees it: the name has been evaluated to a
 * string and `me` has been replaced by the object whose script is running.
 * `background` and `stack` never come from script references (the parser
 * rejects them); they appear only when `me` is a background or stack.
 */
export interface ResolvedObjectRef {
  type: 'button' | 'field' | 'image' | 'card' | 'background' | 'stack';
  name: string;
}

export interface HostInterface {
  // Navigation — async; receives resolved 0-based index
  goToCard(index: number): Promise<void>;
  getCurrentCardIndex(): number;
  getCardCount(): number;
  getCardNames(): string[];

  // Visual effect — async
  setVisualEffect(effect: 'dissolve' | 'wipe left' | 'wipe right' | 'scroll up'): Promise<void>;

  // Dialogs — async
  answer(prompt: string, buttons: string[]): Promise<string>;
  ask(prompt: string, defaultValue: string): Promise<string>;

  // Object visibility — synchronous
  showObject(ref: ResolvedObjectRef): void;
  hideObject(ref: ResolvedObjectRef): void;

  // Property get/set — synchronous
  getProperty(ref: ResolvedObjectRef, property: string): string;
  setProperty(ref: ResolvedObjectRef, property: string, value: string): void;

  // Field access — synchronous
  getFieldText(ref: ResolvedObjectRef): string;
  setFieldText(ref: ResolvedObjectRef, text: string): void;

  // Feedback — synchronous
  beep(): void;

  // Built-ins — synchronous
  getDate(): string;
  getTime(): string;
  random(n: number): number;
}

export interface EvaluateOptions {
  /**
   * The object whose script is running (`me`). Supplied by dispatchMessage for
   * each level of the message path. If absent, any use of `me` is a runtime error.
   */
  me?: ResolvedObjectRef;
  /**
   * When true, every variable in the handler named in the evaluate() call (including
   * `it` and the handler's parameters) reads and writes the `globals` map without a
   * `global` declaration, as variables do in HyperCard's message box. Handlers it calls
   * by name use normal local scoping. Default false.
   */
  implicitGlobals?: boolean;
}

// ---------------------------------------------------------------------------
// Internal exceptions for control flow.
// These never reach callers of evaluate(): misplaced exit/next/pass statements
// are turned into NecroTalkError before they are thrown. PassException is the
// only one that leaves evaluate(), and dispatchMessage consumes it.
// ---------------------------------------------------------------------------

export class ExitHandlerException {
  constructor(public readonly handlerName: string) {}
}

export class ExitRepeatException {}

export class NextRepeatException {}

export class PassException {
  constructor(public readonly handlerName: string) {}
}

const BUDGET_LIMIT = 100_000;
const MAX_CALL_DEPTH = 200;

/** Variable scope and host access shared by statement and expression evaluation. */
interface Scope {
  locals: Map<string, string>;
  globalDecls: Set<string>;
  globals: Map<string, string>;
  host: HostInterface;
  me?: ResolvedObjectRef;
  /** Every variable (including `it`) lives in `globals` (EvaluateOptions.implicitGlobals). */
  implicitGlobals: boolean;
}

/** Per-handler-invocation execution state threaded through executeStatement. */
interface ExecContext extends Scope {
  script: ScriptNode;
  /** Name of the handler currently running, as written in the source. */
  handlerName: string;
  /** Shared across nested handler calls so a recursion loop still hits the budget. */
  budget: { count: number };
  /** Number of enclosing repeat loops in this handler. */
  loopDepth: number;
  /** Nesting depth of custom handler calls. */
  callDepth: number;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// ---------------------------------------------------------------------------
// Public evaluate entry point
// ---------------------------------------------------------------------------

export async function evaluate(
  script: ScriptNode,
  handlerName: string,
  args: string[],
  host: HostInterface,
  globals: Map<string, string>,
  options: EvaluateOptions = {},
): Promise<void> {
  const handler = findHandler(script, handlerName);
  if (!handler) return;
  await runHandler(
    handler, script, args, host, globals, options.me, { count: 0 }, 0, options.implicitGlobals === true,
  );
}

function findHandler(script: ScriptNode, name: string): HandlerNode | undefined {
  return script.handlers.find(h => sameName(h.name, name));
}

async function runHandler(
  handler: HandlerNode,
  script: ScriptNode,
  args: string[],
  host: HostInterface,
  globals: Map<string, string>,
  me: ResolvedObjectRef | undefined,
  budget: { count: number },
  callDepth: number,
  implicitGlobals = false,
): Promise<void> {
  const ctx: ExecContext = {
    script,
    handlerName: handler.name,
    locals: new Map<string, string>(),
    globalDecls: new Set<string>(),
    globals,
    host,
    me,
    implicitGlobals,
    budget,
    loopDepth: 0,
    callDepth,
  };
  for (let i = 0; i < handler.params.length; i++) {
    writeVar(handler.params[i], args[i] ?? '', ctx);
  }

  try {
    for (const stmt of handler.body) {
      await executeStatement(stmt, ctx);
    }
  } catch (e) {
    // executeStatement only throws ExitHandlerException for this handler's own name
    if (e instanceof ExitHandlerException) return;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Statement execution
// ---------------------------------------------------------------------------

function runtimeError(line: number, msg: string): NecroTalkError {
  return new NecroTalkError(formatError(line, 1, msg), line, 1);
}

/** Exceptions the evaluator uses for control flow; never converted to errors. */
function isControlFlow(e: unknown): boolean {
  return e instanceof ExitHandlerException || e instanceof ExitRepeatException
    || e instanceof NextRepeatException || e instanceof PassException;
}

/**
 * Turn an error thrown by a host call into a NecroTalkError at the statement's line, so
 * host errors (`No field named "X"`) read like every other runtime error. NecroTalkErrors
 * (for example from a nested dispatch inside goToCard) and control-flow exceptions pass
 * through unchanged. The host message is kept on one line without a trailing period,
 * because formatError adds one.
 */
function fromHostError(e: unknown, line: number): unknown {
  if (e instanceof NecroTalkError || isControlFlow(e)) return e;
  const raw = e instanceof Error ? e.message : String(e);
  const msg = raw.replace(/\s*[\r\n]+\s*/g, ' ').trim().replace(/\.+$/, '');
  return runtimeError(line, msg === '' ? 'The host reported an error' : msg);
}

/** Run a synchronous host call, converting its errors (see fromHostError). */
function hostCall<T>(line: number, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw fromHostError(e, line);
  }
}

/** Run an asynchronous host call, converting its errors (see fromHostError). */
async function hostCallAsync<T>(line: number, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw fromHostError(e, line);
  }
}

/** Resolve a script object reference: evaluate its name, or substitute `me`. */
function resolveRef(ref: ObjectRef, scope: Scope, line: number): ResolvedObjectRef {
  if (ref.type === 'me') {
    if (!scope.me) throw runtimeError(line, '"me" is not available here');
    return scope.me;
  }
  return { type: ref.type, name: evaluateExpression(ref.name, scope, line) };
}

async function executeBlock(stmts: StatementNode[], ctx: ExecContext): Promise<void> {
  for (const s of stmts) await executeStatement(s, ctx);
}

/** Run one loop iteration; returns 'break' when the body executed `exit repeat`. */
async function runLoopBody(body: StatementNode[], ctx: ExecContext): Promise<'continue' | 'break'> {
  ctx.loopDepth++;
  try {
    await executeBlock(body, ctx);
    return 'continue';
  } catch (e) {
    if (e instanceof ExitRepeatException) return 'break';
    if (e instanceof NextRepeatException) return 'continue';
    throw e;
  } finally {
    ctx.loopDepth--;
  }
}

async function executeStatement(stmt: StatementNode, ctx: ExecContext): Promise<void> {
  const { globalDecls, globals, host } = ctx;
  const line = stmt.line;
  const evalExpr = (e: ExpressionNode) => evaluateExpression(e, ctx, line);

  ctx.budget.count++;
  if (ctx.budget.count > BUDGET_LIMIT) {
    throw runtimeError(stmt.line, 'Script ran too long');
  }

  switch (stmt.kind) {
    case 'beep':
      hostCall(line, () => host.beep());
      return;

    case 'go': {
      const index = hostCall(line, () => host.getCurrentCardIndex());
      const count = hostCall(line, () => host.getCardCount());
      const names = hostCall(line, () => host.getCardNames());
      const resolved = resolveNavigation(stmt.target, index, count, names, line);
      await hostCallAsync(line, () => host.goToCard(resolved));
      return;
    }

    case 'visualEffect':
      await hostCallAsync(line, () => host.setVisualEffect(stmt.effect));
      return;

    case 'put':
      writeContainer(stmt.target, stmt.mode, evalExpr(stmt.value), ctx, line);
      return;

    case 'get':
      writeVar('it', evalExpr(stmt.value), ctx);
      return;

    case 'set': {
      const ref = resolveRef(stmt.object, ctx, line);
      const value = evalExpr(stmt.value);
      hostCall(line, () => host.setProperty(ref, stmt.property, value));
      return;
    }

    case 'global': {
      // From here on, reads and writes of this name in this handler go to the
      // stack-wide variable. A same-named local is shadowed, never copied over it.
      globalDecls.add(stmt.varName.toLowerCase());
      return;
    }

    case 'answer': {
      const prompt = evalExpr(stmt.prompt);
      const result = await hostCallAsync(line, () => host.answer(prompt, stmt.buttons));
      writeVar('it', result, ctx);
      return;
    }

    case 'ask': {
      const prompt = evalExpr(stmt.prompt);
      const def = stmt.default ? evalExpr(stmt.default) : '';
      const result = await hostCallAsync(line, () => host.ask(prompt, def));
      writeVar('it', result, ctx);
      return;
    }

    case 'show': {
      const ref = resolveRef(stmt.object, ctx, line);
      hostCall(line, () => host.showObject(ref));
      return;
    }

    case 'hide': {
      const ref = resolveRef(stmt.object, ctx, line);
      hostCall(line, () => host.hideObject(ref));
      return;
    }

    case 'if': {
      const branch = isTruthy(evalExpr(stmt.condition)) ? stmt.thenBranch : (stmt.elseBranch ?? []);
      await executeBlock(branch, ctx);
      return;
    }

    case 'repeat': {
      const v = stmt.variant;
      if (v.type === 'times') {
        const n = Math.floor(toNumber(evalExpr(v.count), stmt.line));
        for (let i = 0; i < n; i++) {
          if (await runLoopBody(stmt.body, ctx) === 'break') break;
        }
      } else if (v.type === 'with') {
        const from = toNumber(evalExpr(v.from), stmt.line);
        const to = toNumber(evalExpr(v.to), stmt.line);
        for (let i = from; i <= to; i++) {
          writeVar(v.varName, String(i), ctx);
          if (await runLoopBody(stmt.body, ctx) === 'break') break;
        }
      } else {
        while (isTruthy(evalExpr(v.condition))) {
          if (await runLoopBody(stmt.body, ctx) === 'break') break;
        }
      }
      return;
    }

    case 'exit': {
      if (stmt.target === 'repeat') {
        if (ctx.loopDepth === 0) throw runtimeError(stmt.line, '"exit repeat" can only be used inside a repeat loop');
        throw new ExitRepeatException();
      }
      if (!sameName(stmt.target, ctx.handlerName)) {
        throw runtimeError(stmt.line,
          `"exit ${stmt.target}" does not match the running handler "${ctx.handlerName}"`);
      }
      throw new ExitHandlerException(stmt.target);
    }

    case 'nextRepeat':
      if (ctx.loopDepth === 0) throw runtimeError(stmt.line, '"next repeat" can only be used inside a repeat loop');
      throw new NextRepeatException();

    case 'pass':
      if (!sameName(stmt.handlerName, ctx.handlerName)) {
        throw runtimeError(stmt.line,
          `"pass ${stmt.handlerName}" does not match the running handler "${ctx.handlerName}"`);
      }
      throw new PassException(stmt.handlerName);

    case 'call': {
      const target = findHandler(ctx.script, stmt.name);
      if (!target) throw runtimeError(stmt.line, `Unknown command "${stmt.name}"`);
      if (ctx.callDepth >= MAX_CALL_DEPTH) {
        throw runtimeError(stmt.line, `Too many nested handler calls (more than ${MAX_CALL_DEPTH})`);
      }
      const args = stmt.args.map(evalExpr);
      try {
        // Same script, so the called handler runs with the same `me`
        await runHandler(target, ctx.script, args, host, globals, ctx.me, ctx.budget, ctx.callDepth + 1);
      } catch (e) {
        // A directly called handler has no further message path, so `pass` just ends it.
        if (e instanceof PassException) return;
        throw e;
      }
      return;
    }

    default:
      throw runtimeError((stmt as StatementNode).line, 'Internal error, unsupported statement');
  }
}

// ---------------------------------------------------------------------------
// Variable read/write helpers
// ---------------------------------------------------------------------------

/**
 * The stored value of a variable, or undefined if it has never been set.
 * Stack-wide globals are visible only in handlers that declared them with `global`,
 * unless the handler runs with implicitGlobals (then every variable, `it` included,
 * lives in the globals map).
 */
function storedVar(key: string, scope: Scope): string | undefined {
  const k = key.toLowerCase();
  if (scope.implicitGlobals) return k === 'it' ? (scope.globals.get('it') ?? '') : scope.globals.get(k);
  if (k === 'it') return scope.locals.get('it') ?? '';
  if (scope.globalDecls.has(k)) return scope.globals.get(k) ?? '';
  return scope.locals.get(k);
}

/** Read a variable in an expression. HyperCard: an unset variable evaluates to its own name. */
function readVar(key: string, scope: Scope): string {
  return storedVar(key, scope) ?? key.toLowerCase();
}

function writeVar(key: string, value: string, scope: Scope): void {
  const k = key.toLowerCase();
  if (scope.implicitGlobals || scope.globalDecls.has(k)) {
    scope.globals.set(k, value);
  } else {
    scope.locals.set(k, value);
  }
}

function writeContainer(
  container: ContainerNode,
  mode: 'into' | 'before' | 'after',
  value: string,
  scope: Scope,
  line: number,
): void {
  if (container.kind === 'it') {
    writeVar('it', applyMode(storedVar('it', scope) ?? '', value, mode), scope);
    return;
  }
  if (container.kind === 'variable') {
    // As a put target, an unset variable starts out empty (not its own name)
    const current = storedVar(container.name, scope) ?? '';
    writeVar(container.name, applyMode(current, value, mode), scope);
    return;
  }
  // field container
  const ref = resolveRef(container.ref, scope, line);
  const { host } = scope;
  const current = hostCall(line, () => host.getFieldText(ref));
  hostCall(line, () => host.setFieldText(ref, applyMode(current, value, mode)));
}

function applyMode(current: string, value: string, mode: 'into' | 'before' | 'after'): string {
  if (mode === 'into') return value;
  if (mode === 'before') return value + current;
  return current + value;
}

// ---------------------------------------------------------------------------
// Expression evaluation
// ---------------------------------------------------------------------------

function evaluateExpression(expr: ExpressionNode, scope: Scope, currentLine: number): string {
  const ev = (e: ExpressionNode) => evaluateExpression(e, scope, currentLine);
  const { host } = scope;

  switch (expr.kind) {
    case 'literal':
      if (typeof expr.value === 'boolean') return expr.value ? 'true' : 'false';
      return String(expr.value);

    case 'variable':
      return readVar(expr.name, scope);

    case 'binary':
      return evaluateBinaryOp(expr.op, ev(expr.left), ev(expr.right), currentLine);

    case 'unary': {
      const val = ev(expr.operand);
      if (expr.op === 'not') return isTruthy(val) ? 'false' : 'true';
      return String(-toNumber(val, currentLine));
    }

    case 'functionCall':
      return callFunction(expr.name, expr.args.map(ev), host, currentLine);

    case 'field': {
      const ref = resolveRef(expr.ref, scope, currentLine);
      return hostCall(currentLine, () => host.getFieldText(ref));
    }

    case 'property': {
      if (expr.object) {
        const ref = resolveRef(expr.object, scope, currentLine);
        return hostCall(currentLine, () => host.getProperty(ref, expr.property));
      }
      // Bare `the <name>` is valid only for `the date` and `the time`
      const prop = expr.property.toLowerCase();
      if (prop === 'date') return hostCall(currentLine, () => host.getDate());
      if (prop === 'time') return hostCall(currentLine, () => host.getTime());
      throw runtimeError(currentLine, `Unknown property "${expr.property}"`);
    }

    case 'chunk': {
      const src = ev(expr.source);
      const idx = Math.floor(toNumber(ev(expr.index), currentLine));
      return getChunk(expr.chunkType, idx, src);
    }

    case 'count': {
      if (expr.what === 'cards') return String(hostCall(currentLine, () => host.getCardCount()));
      return String(countChunks(expr.what, ev(expr.source!)));
    }

    default:
      throw runtimeError(currentLine, 'Internal error, unsupported expression');
  }
}

// ---------------------------------------------------------------------------
// Binary operator evaluation
// ---------------------------------------------------------------------------

function evaluateBinaryOp(op: BinaryOp, left: string, right: string, line: number): string {
  switch (op) {
    case '+': return String(toNumber(left, line) + toNumber(right, line));
    case '-': return String(toNumber(left, line) - toNumber(right, line));
    case '*': return String(toNumber(left, line) * toNumber(right, line));
    case '/': return String(toNumber(left, line) / toNumber(right, line));
    case 'mod': return String(toNumber(left, line) % toNumber(right, line));
    case '^': return String(Math.pow(toNumber(left, line), toNumber(right, line)));
    case '&': return left + right;
    case '&&': return left + ' ' + right;
    case '=': return numericOrStringCompare(left, right) === 0 ? 'true' : 'false';
    case '<>': return numericOrStringCompare(left, right) !== 0 ? 'true' : 'false';
    case '<': return numericOrStringCompare(left, right) < 0 ? 'true' : 'false';
    case '>': return numericOrStringCompare(left, right) > 0 ? 'true' : 'false';
    case '<=': return numericOrStringCompare(left, right) <= 0 ? 'true' : 'false';
    case '>=': return numericOrStringCompare(left, right) >= 0 ? 'true' : 'false';
    case 'is': return numericOrStringCompare(left, right) === 0 ? 'true' : 'false';
    case 'is not': return numericOrStringCompare(left, right) !== 0 ? 'true' : 'false';
    case 'contains': return left.includes(right) ? 'true' : 'false';
    case 'and': return (isTruthy(left) && isTruthy(right)) ? 'true' : 'false';
    case 'or': return (isTruthy(left) || isTruthy(right)) ? 'true' : 'false';
  }
}

function numericOrStringCompare(a: string, b: string): number {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb) && String(na) === a.trim() && String(nb) === b.trim()) {
    return na < nb ? -1 : na > nb ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Built-in functions
// ---------------------------------------------------------------------------

/** Built-in functions and their exact argument counts. A Map, so names like
 *  "constructor" are not found on Object.prototype. */
const FUNCTION_ARITY = new Map<string, number>([['random', 1], ['length', 1]]);

function callFunction(name: string, args: string[], host: HostInterface, line: number): string {
  const key = name.toLowerCase();
  const arity = FUNCTION_ARITY.get(key);
  if (arity === undefined) throw runtimeError(line, `Unknown function "${name}"`);
  if (args.length !== arity) {
    throw runtimeError(line, `${name} expects ${arity} argument${arity === 1 ? '' : 's'}`);
  }
  if (key === 'random') {
    const n = Math.floor(toNumber(args[0], line));
    return String(hostCall(line, () => host.random(n)));
  }
  return String(args[0].length); // length
}

function getChunk(type: 'word' | 'line' | 'char', index: number, source: string): string {
  if (index < 1) return '';
  if (type === 'word') {
    const words = source.trim().split(/\s+/).filter(w => w.length > 0);
    return words[index - 1] ?? '';
  }
  if (type === 'line') {
    const lines = source.split('\n');
    return lines[index - 1] ?? '';
  }
  // char
  return source[index - 1] ?? '';
}

function countChunks(what: 'words' | 'lines' | 'chars', source: string): number {
  if (what === 'words') return source.trim() === '' ? 0 : source.trim().split(/\s+/).length;
  if (what === 'lines') return source.split('\n').length;
  return source.length;
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

/** Quote a runtime value for an error message: one line, at most 40 characters. */
function quoteValue(value: string): string {
  const oneLine = value.replace(/\r\n|\r|\n/g, ' ');
  return `"${oneLine.length > 40 ? oneLine.slice(0, 40) + '…' : oneLine}"`;
}

function toNumber(value: string, line: number): number {
  if (value === 'true') return 1;
  if (value === 'false') return 0;
  const n = parseFloat(value);
  if (isNaN(n)) {
    throw runtimeError(line, `Expected a number but got ${quoteValue(value)}`);
  }
  return n;
}

function isTruthy(value: string): boolean {
  return value !== '' && value !== '0' && value.toLowerCase() !== 'false';
}
