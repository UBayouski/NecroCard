import { parse } from '../../interp/parser.js';
import { evaluate, type HostInterface } from '../../interp/evaluator.js';
import { NecroTalkError, formatError } from '../../interp/errors.js';

/** Name of the hidden handler the typed line is wrapped in. Not a NecroTalk keyword. */
export const WRAPPER_HANDLER = 'messageBox';

/** Lines of wrapper before the typed line (`on messageBox`). */
export const LINE_OFFSET = 1;

/** Wrap one typed line so the normal parser can read it; the typed line becomes line 2. */
export function wrapStatement(line: string): string {
  return `on ${WRAPPER_HANDLER}\n${line}\nend ${WRAPPER_HANDLER}`;
}

/** Map a wrapped-source line number back to the typed line (line 2 → line 1, never below 1). */
export function remapLine(message: string): string {
  return message.replace(/^Line (\d+):/, (_, n: string) => `Line ${Math.max(1, Number(n) - LINE_OFFSET)}:`);
}

function oneStatementError(): NecroTalkError {
  return new NecroTalkError(formatError(1, 1, 'The message box runs one statement'), 1, 1);
}

/**
 * Run one NecroTalk statement typed into the message box (REQ-7). `me` is not available.
 * As in HyperCard, message-box variables (including `it`) are global: the statement runs
 * with `implicitGlobals`, so it shares the stack's globals with handlers that declare them.
 * NecroTalk errors are rethrown with line numbers relative to the typed line.
 */
export async function runMessageBoxLine(
  line: string, host: HostInterface, globals: Map<string, string>,
): Promise<void> {
  if (line.trim() === '') return;
  if (/[\r\n]/.test(line)) throw oneStatementError();
  try {
    const script = parse(wrapStatement(line));
    const handler = script.handlers[0];
    if (script.handlers.length !== 1 || !handler) throw oneStatementError();
    if (handler.body.length === 0) return; // e.g. a comment only
    if (handler.body.length > 1) throw oneStatementError();
    await evaluate(script, WRAPPER_HANDLER, [], host, globals, { implicitGlobals: true });
  } catch (e) {
    if (e instanceof NecroTalkError && e.line > LINE_OFFSET) {
      throw new NecroTalkError(remapLine(e.message), e.line - LINE_OFFSET, e.column);
    }
    throw e;
  }
}
