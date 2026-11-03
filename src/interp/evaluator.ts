import { NecroTalkError, formatError } from './errors.js';
import { resolveNavigation } from './navigation.js';
import type {
  ScriptNode, StatementNode, ExpressionNode,
  BinaryOp, ContainerNode, ObjectRef,
} from './ast.js';

// ---------------------------------------------------------------------------
// Host interface
// ---------------------------------------------------------------------------

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
  showObject(ref: ObjectRef): void;
  hideObject(ref: ObjectRef): void;

  // Property get/set — synchronous
  getProperty(ref: ObjectRef, property: string): string;
  setProperty(ref: ObjectRef, property: string, value: string): void;

  // Field access — synchronous
  getFieldText(ref: ObjectRef): string;
  setFieldText(ref: ObjectRef, text: string): void;

  // Feedback — synchronous
  beep(): void;

  // Built-ins — synchronous
  getDate(): string;
  getTime(): string;
  random(n: number): number;
}

// ---------------------------------------------------------------------------
// Internal exceptions for control flow
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

// ---------------------------------------------------------------------------
// Public evaluate entry point
// ---------------------------------------------------------------------------

export async function evaluate(
  script: ScriptNode,
  handlerName: string,
  args: string[],
  host: HostInterface,
  globals: Map<string, string>,
): Promise<void> {
  const handler = script.handlers.find(
    h => h.name.toLowerCase() === handlerName.toLowerCase(),
  );
  if (!handler) return;

  const locals = new Map<string, string>();
  const globalDecls = new Set<string>();

  for (let i = 0; i < handler.params.length; i++) {
    locals.set(handler.params[i].toLowerCase(), args[i] ?? '');
  }

  const budget = { count: 0 };

  try {
    for (const stmt of handler.body) {
      await executeStatement(stmt, locals, globalDecls, globals, host, budget);
    }
  } catch (e) {
    if (e instanceof ExitHandlerException) {
      if (e.handlerName.toLowerCase() === handlerName.toLowerCase()) return;
      throw e;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Statement execution
// ---------------------------------------------------------------------------

async function executeStatement(
  stmt: StatementNode,
  locals: Map<string, string>,
  globalDecls: Set<string>,
  globals: Map<string, string>,
  host: HostInterface,
  budget: { count: number },
): Promise<void> {
  budget.count++;
  if (budget.count > BUDGET_LIMIT) {
    throw new NecroTalkError(
      formatError(stmt.line, 1, 'Script ran too long'),
      stmt.line, 1,
    );
  }

  switch (stmt.kind) {
    case 'beep':
      host.beep();
      return;

    case 'go': {
      const currentIndex = host.getCurrentCardIndex();
      const cardCount = host.getCardCount();
      const cardNames = host.getCardNames();
      const resolved = resolveNavigation(stmt.target, currentIndex, cardCount, cardNames, stmt.line);
      await host.goToCard(resolved);
      return;
    }

    case 'visualEffect':
      await host.setVisualEffect(stmt.effect);
      return;

    case 'put': {
      const value = evaluateExpression(stmt.value, locals, globalDecls, globals, host, stmt.line);
      writeContainer(stmt.target, stmt.mode, value, locals, globalDecls, globals, host);
      return;
    }

    case 'get': {
      const value = evaluateExpression(stmt.value, locals, globalDecls, globals, host, stmt.line);
      writeVar('it', value, locals, globalDecls, globals);
      return;
    }

    case 'set': {
      const value = evaluateExpression(stmt.value, locals, globalDecls, globals, host, stmt.line);
      host.setProperty(stmt.object, stmt.property, value);
      return;
    }

    case 'global': {
      const key = stmt.varName.toLowerCase();
      globalDecls.add(key);
      // if local already has this, migrate to globals
      if (locals.has(key)) {
        globals.set(key, locals.get(key)!);
        locals.delete(key);
      }
      return;
    }

    case 'answer': {
      const prompt = evaluateExpression(stmt.prompt, locals, globalDecls, globals, host, stmt.line);
      const result = await host.answer(prompt, stmt.buttons);
      writeVar('it', result, locals, globalDecls, globals);
      return;
    }

    case 'ask': {
      const prompt = evaluateExpression(stmt.prompt, locals, globalDecls, globals, host, stmt.line);
      const def = stmt.default
        ? evaluateExpression(stmt.default, locals, globalDecls, globals, host, stmt.line)
        : '';
      const result = await host.ask(prompt, def);
      writeVar('it', result, locals, globalDecls, globals);
      return;
    }

    case 'show':
      host.showObject(stmt.object);
      return;

    case 'hide':
      host.hideObject(stmt.object);
      return;

    case 'if': {
      const cond = evaluateExpression(stmt.condition, locals, globalDecls, globals, host, stmt.line);
      const branch = isTruthy(cond) ? stmt.thenBranch : (stmt.elseBranch ?? []);
      for (const s of branch) {
        await executeStatement(s, locals, globalDecls, globals, host, budget);
      }
      return;
    }

    case 'repeat': {
      const v = stmt.variant;
      if (v.type === 'times') {
        const n = toNumber(
          evaluateExpression(v.count, locals, globalDecls, globals, host, stmt.line),
          stmt.line,
        );
        for (let i = 0; i < Math.floor(n); i++) {
          try {
            for (const s of stmt.body) {
              await executeStatement(s, locals, globalDecls, globals, host, budget);
            }
          } catch (e) {
            if (e instanceof ExitRepeatException) break;
            if (e instanceof NextRepeatException) continue;
            throw e;
          }
        }
      } else if (v.type === 'with') {
        const from = toNumber(
          evaluateExpression(v.from, locals, globalDecls, globals, host, stmt.line),
          stmt.line,
        );
        const to = toNumber(
          evaluateExpression(v.to, locals, globalDecls, globals, host, stmt.line),
          stmt.line,
        );
        for (let i = from; i <= to; i++) {
          writeVar(v.varName, String(i), locals, globalDecls, globals);
          try {
            for (const s of stmt.body) {
              await executeStatement(s, locals, globalDecls, globals, host, budget);
            }
          } catch (e) {
            if (e instanceof ExitRepeatException) break;
            if (e instanceof NextRepeatException) continue;
            throw e;
          }
        }
      } else {
        // while
        while (true) {
          const cond = evaluateExpression(v.condition, locals, globalDecls, globals, host, stmt.line);
          if (!isTruthy(cond)) break;
          try {
            for (const s of stmt.body) {
              await executeStatement(s, locals, globalDecls, globals, host, budget);
            }
          } catch (e) {
            if (e instanceof ExitRepeatException) break;
            if (e instanceof NextRepeatException) continue;
            throw e;
          }
        }
      }
      return;
    }

    case 'exit':
      if (stmt.target === 'repeat') throw new ExitRepeatException();
      throw new ExitHandlerException(stmt.target);

    case 'nextRepeat':
      throw new NextRepeatException();

    case 'pass':
      throw new PassException(stmt.handlerName);

    default:
      throw new NecroTalkError(
        formatError((stmt as StatementNode).line, 1, `Unknown statement kind "${(stmt as StatementNode).kind}"`),
        (stmt as StatementNode).line, 1,
      );
  }
}

// ---------------------------------------------------------------------------
// Variable read/write helpers
// ---------------------------------------------------------------------------

function readVar(key: string, locals: Map<string, string>, globalDecls: Set<string>, globals: Map<string, string>): string {
  const k = key.toLowerCase();
  if (k === 'it') return locals.get('it') ?? '';
  if (globalDecls.has(k)) return globals.get(k) ?? '';
  if (locals.has(k)) return locals.get(k)!;
  if (globals.has(k)) return globals.get(k)!;
  return k; // HyperCard: unset variable evaluates to its own name
}

function writeVar(key: string, value: string, locals: Map<string, string>, globalDecls: Set<string>, globals: Map<string, string>): void {
  const k = key.toLowerCase();
  if (globalDecls.has(k)) {
    globals.set(k, value);
  } else {
    locals.set(k, value);
  }
}

function writeContainer(
  container: ContainerNode,
  mode: 'into' | 'before' | 'after',
  value: string,
  locals: Map<string, string>,
  globalDecls: Set<string>,
  globals: Map<string, string>,
  host: HostInterface,
): void {
  if (container.kind === 'it') {
    const current = locals.get('it') ?? '';
    const result = applyMode(current, value, mode);
    locals.set('it', result);
    return;
  }
  if (container.kind === 'variable') {
    const current = readVar(container.name, locals, globalDecls, globals);
    const result = applyMode(current, value, mode);
    writeVar(container.name, result, locals, globalDecls, globals);
    return;
  }
  // field container
  const current = host.getFieldText(container.ref);
  const result = applyMode(current, value, mode);
  host.setFieldText(container.ref, result);
}

function applyMode(current: string, value: string, mode: 'into' | 'before' | 'after'): string {
  if (mode === 'into') return value;
  if (mode === 'before') return value + current;
  return current + value;
}

// ---------------------------------------------------------------------------
// Expression evaluation
// ---------------------------------------------------------------------------

export function evaluateExpression(
  expr: ExpressionNode,
  locals: Map<string, string>,
  globalDecls: Set<string>,
  globals: Map<string, string>,
  host: HostInterface,
  currentLine: number,
): string {
  switch (expr.kind) {
    case 'literal':
      if (typeof expr.value === 'boolean') return expr.value ? 'true' : 'false';
      return String(expr.value);

    case 'variable':
      return readVar(expr.name, locals, globalDecls, globals);

    case 'binary': {
      const left = evaluateExpression(expr.left, locals, globalDecls, globals, host, currentLine);
      const right = evaluateExpression(expr.right, locals, globalDecls, globals, host, currentLine);
      return evaluateBinaryOp(expr.op, left, right, currentLine);
    }

    case 'unary': {
      const val = evaluateExpression(expr.operand, locals, globalDecls, globals, host, currentLine);
      if (expr.op === 'not') return isTruthy(val) ? 'false' : 'true';
      const n = toNumber(val, currentLine);
      return String(-n);
    }

    case 'functionCall': {
      const args = expr.args.map(a => evaluateExpression(a, locals, globalDecls, globals, host, currentLine));
      return callFunction(expr.name, args, host, currentLine);
    }

    case 'property': {
      if (expr.property === 'date') return host.getDate();
      if (expr.property === 'time') return host.getTime();
      if (expr.object) return host.getProperty(expr.object, expr.property);
      return host.getProperty({ type: 'stack' }, expr.property);
    }

    case 'chunk': {
      const src = evaluateExpression(expr.source, locals, globalDecls, globals, host, currentLine);
      const idx = Math.floor(toNumber(
        evaluateExpression(expr.index, locals, globalDecls, globals, host, currentLine),
        currentLine,
      ));
      return getChunk(expr.chunkType, idx, src);
    }

    case 'count': {
      if (expr.what === 'cards') return String(host.getCardCount());
      const src = evaluateExpression(expr.source!, locals, globalDecls, globals, host, currentLine);
      return String(countChunks(expr.what, src));
    }

    default:
      throw new NecroTalkError(
        formatError(currentLine, 1, `Unknown expression kind "${(expr as ExpressionNode).kind}"`),
        currentLine, 1,
      );
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

function callFunction(name: string, args: string[], host: HostInterface, line: number): string {
  switch (name.toLowerCase()) {
    case 'random': {
      const n = toNumber(args[0] ?? '1', line);
      return String(host.random(Math.floor(n)));
    }
    case 'length':
      return String((args[0] ?? '').length);
    default:
      throw new NecroTalkError(
        formatError(line, 1, `Unknown function "${name}"`),
        line, 1,
      );
  }
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

function toNumber(value: string, line: number): number {
  if (value === 'true') return 1;
  if (value === 'false') return 0;
  const n = parseFloat(value);
  if (isNaN(n)) {
    throw new NecroTalkError(
      formatError(line, 1, `Expected a number but got "${value}"`),
      line, 1,
    );
  }
  return n;
}

function isTruthy(value: string): boolean {
  return value !== '' && value !== '0' && value.toLowerCase() !== 'false';
}
