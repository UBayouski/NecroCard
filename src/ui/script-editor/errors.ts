import { parse } from '../../interp/parser.js';
import { NecroTalkError } from '../../interp/errors.js';

/** The first problem in a script: a 1-based line (clamped to the script) or null when unknown. */
export interface ScriptError {
  line: number | null;
  message: string;
}

/** Parse the whole script; null when it parses (or is blank). Never throws. */
export function findError(source: string): ScriptError | null {
  if (source.trim() === '') return null;
  try {
    parse(source);
    return null;
  } catch (e) {
    if (e instanceof NecroTalkError) {
      const lineCount = source.split('\n').length;
      return { line: Math.min(Math.max(1, e.line), lineCount), message: e.message };
    }
    return { line: null, message: e instanceof Error ? e.message : String(e) };
  }
}
