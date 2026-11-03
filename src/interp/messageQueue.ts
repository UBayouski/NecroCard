import { parse } from './parser.js';
import { evaluate, PassException } from './evaluator.js';
import type { HostInterface, ResolvedObjectRef } from './evaluator.js';
import type { ScriptNode } from './ast.js';

export { PassException };

/**
 * Scripts along the message path, each paired with the object that owns it.
 * The owner becomes `me` while its script handles the message.
 */
export interface MessageContext {
  objectScript?: string;
  /** The object (button, field, or image) that received the message. */
  object?: ResolvedObjectRef;
  cardScript: string;
  card: ResolvedObjectRef;
  backgroundScript: string;
  background: ResolvedObjectRef;
  stackScript: string;
  stack: ResolvedObjectRef;
}

/**
 * Dispatch a message through the NecroTalk message-passing chain:
 * object → card → background → stack.
 *
 * `me` is the owner of whichever script handles the message, so after a
 * `pass` it becomes the card, background, or stack in turn.
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
  const levels: { source: string | undefined; me: ResolvedObjectRef | undefined }[] = [
    { source: context.objectScript, me: context.object },
    { source: context.cardScript, me: context.card },
    { source: context.backgroundScript, me: context.background },
    { source: context.stackScript, me: context.stack },
  ];

  // Parse each source string at most once per dispatch call
  const parseCache = new Map<string, ScriptNode>();
  const getParsed = (src: string): ScriptNode => {
    if (!parseCache.has(src)) parseCache.set(src, parse(src));
    return parseCache.get(src)!;
  };

  for (const { source, me } of levels) {
    if (typeof source !== 'string' || source.trim().length === 0) continue;
    const scriptNode = getParsed(source);
    // Only try if the script actually contains this handler
    const hasHandler = scriptNode.handlers.some(
      h => h.name.toLowerCase() === message.toLowerCase(),
    );
    if (!hasHandler) continue;
    try {
      await evaluate(scriptNode, message, args, host, globals, { me });
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
