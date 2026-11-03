import { tokenize } from '../../interp/tokenizer.js';
import { parse } from '../../interp/parser.js';
import { evaluate, type HostInterface } from '../../interp/evaluator.js';
import { NecroTalkError, formatError } from '../../interp/errors.js';

/** Name of the hidden handler the typed line is wrapped in. Not a NecroTalk keyword. */
export const WRAPPER_HANDLER = 'messageBox';

/** Wrapped source plus how many lines precede the typed line. */
export interface Wrapped {
  source: string;
  /** Number of wrapper lines before the typed line (1 + number of global declarations). */
  offset: number;
  /** Number of `global` statements inserted ahead of the typed statement. */
  declarations: number;
}

/**
 * Wrap one typed line so the normal parser can read it. As in HyperCard, variables used in
 * the message box are global: every identifier in the line is declared `global` first, so
 * the box reads and writes the same values as handlers that declare those globals.
 * (Identifiers that turn out to be property, function or handler names are harmless.)
 */
export function wrapStatement(line: string): Wrapped {
  const names = new Set<string>();
  for (const t of tokenize(line)) {
    if (t.type === 'identifier') names.add(t.value.toLowerCase());
  }
  const globals = [...names].map(n => `global ${n}`);
  return {
    source: [`on ${WRAPPER_HANDLER}`, ...globals, line, `end ${WRAPPER_HANDLER}`].join('\n'),
    offset: 1 + globals.length,
    declarations: globals.length,
  };
}

/** Map a wrapped-source line number back to the typed line (never below line 1). */
export function remapLine(message: string, offset: number): string {
  return message.replace(/^Line (\d+):/, (_, n: string) => `Line ${Math.max(1, Number(n) - offset)}:`);
}

function oneStatementError(): NecroTalkError {
  return new NecroTalkError(formatError(1, 1, 'The message box runs one statement'), 1, 1);
}

/**
 * Run one NecroTalk statement typed into the message box (REQ-7). `me` is not available.
 * NecroTalk errors are rethrown with line numbers relative to the typed line.
 */
export async function runMessageBoxLine(
  line: string, host: HostInterface, globals: Map<string, string>,
): Promise<void> {
  if (line.trim() === '') return;
  if (/[\r\n]/.test(line)) throw oneStatementError();
  // Tokenize errors come from the bare line, so they already say "Line 1".
  const wrapped = wrapStatement(line);
  try {
    const script = parse(wrapped.source);
    const handler = script.handlers[0];
    if (script.handlers.length !== 1 || !handler) throw oneStatementError();
    const typed = handler.body.length - wrapped.declarations;
    if (typed === 0) return; // e.g. a comment only
    if (typed > 1) throw oneStatementError();
    await evaluate(script, WRAPPER_HANDLER, [], host, globals, {});
  } catch (e) {
    if (e instanceof NecroTalkError && e.line > 1) {
      throw new NecroTalkError(remapLine(e.message, wrapped.offset), Math.max(1, e.line - wrapped.offset), e.column);
    }
    throw e;
  }
}
