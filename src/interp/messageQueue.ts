import { parse } from './parser.js';
import { evaluate, PassException } from './evaluator.js';
import type { HostInterface } from './evaluator.js';
import type { ScriptNode } from './ast.js';

export { PassException };

export interface MessageContext {
  objectScript?: string;
  cardScript: string;
  backgroundScript: string;
  stackScript: string;
}

/**
 * Dispatch a message through the NecroTalk message-passing chain:
 * object → card → background → stack.
 *
 * Each source string is parsed at most once per call (local parse cache).
 * If a handler calls `pass`, the search continues at the next level.
 * If no handler is found anywhere, returns silently.
 */
export async function dispatchMessage(
  message: string,
  args: string[],
  context: MessageContext,
  host: HostInterface,
  globals: Map<string, string>,
): Promise<void> {
  const scripts = [
    context.objectScript,
    context.cardScript,
    context.backgroundScript,
    context.stackScript,
  ].filter((s): s is string => typeof s === 'string' && s.trim().length > 0);

  // Parse each source string at most once per dispatch call
  const parseCache = new Map<string, ScriptNode>();
  const getParsed = (src: string): ScriptNode => {
    if (!parseCache.has(src)) parseCache.set(src, parse(src));
    return parseCache.get(src)!;
  };

  for (const scriptSource of scripts) {
    const scriptNode = getParsed(scriptSource);
    // Only try if the script actually contains this handler
    const hasHandler = scriptNode.handlers.some(
      h => h.name.toLowerCase() === message.toLowerCase()
    );
    if (!hasHandler) continue;
    try {
      await evaluate(scriptNode, message, args, host, globals);
      return; // handler ran without pass; stop
    } catch (e) {
      if (e instanceof PassException &&
          e.handlerName.toLowerCase() === message.toLowerCase()) {
        continue; // pass — try next level
      }
      throw e; // propagate other errors
    }
  }
  // No handler found anywhere — silently return
}
