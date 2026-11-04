// Public module of src/summon/: the agent boundary the UI depends on (script-editor REQ-5.1).
// src/ui/ may import it; src/summon/ never imports src/ui/ (structure.md).
// The stub stays for tests and for builds without Summon; createAgentClient is the real client (summon REQ-7.1).
import { TransportError, type Transport } from './transport.js';

export type ScriptOwnerType = 'button' | 'field' | 'image' | 'card' | 'background' | 'stack';

/** What the agent is told about the script it explains or fixes. */
export interface ScriptContext {
  owner: { type: ScriptOwnerType; name: string };
  stackName: string;
  /** The card being edited (null for background and stack scripts). */
  cardName: string | null;
  backgroundName: string | null;
  /** Objects on the current card and its background, so a fix can refer to them by name. */
  objectNames: { type: 'button' | 'field' | 'image'; name: string }[];
}

export interface AgentClient {
  /** A plain-English explanation of the script. */
  explain(script: string, context: ScriptContext, signal?: AbortSignal): Promise<string>;
  /** A complete replacement script; `error` is the current inline error message, if any. */
  fix(script: string, error: string | null, context: ScriptContext, signal?: AbortSignal): Promise<string>;
}

/** No agent is configured (the stub), or the configured one is unavailable. */
export class AgentUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentUnavailableError';
  }
}

export const NOT_CONFIGURED = 'Summon is not configured';

/** The client used until spec `summon` ships a real one: every call rejects, no network. */
export function createStubAgentClient(): AgentClient {
  const reject = (signal?: AbortSignal): Promise<never> => {
    if (signal?.aborted) return Promise.reject(new DOMException('The request was cancelled', 'AbortError'));
    return Promise.reject(new AgentUnavailableError(NOT_CONFIGURED));
  };
  return {
    explain: (_script, _context, signal) => reject(signal),
    fix: (_script, _error, _context, signal) => reject(signal),
  };
}

export const AGENT_FAILED = 'The agent is not available right now';

/** A reply wrapped in one Markdown code fence → its content; anything else → trimmed as is. */
export function stripFence(text: string): string {
  const fenced = /^\s*```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

/**
 * The real client. `transportFor` is called on every request, so storing or clearing a key in Settings
 * switches between the direct and the server path without a reload (summon REQ-7.2).
 */
export function createAgentClient(transportFor: () => Transport): AgentClient {
  async function ask(send: (t: Transport) => Promise<{ text: string }>): Promise<string> {
    try {
      return (await send(transportFor())).text;
    } catch (e) {
      if (isAbort(e)) throw e;
      if (e instanceof TransportError) throw new AgentUnavailableError(e.message);
      throw new AgentUnavailableError(AGENT_FAILED);
    }
  }
  return {
    explain: async (script, context, signal) =>
      (await ask(t => t.send({ kind: 'explain', payload: { script, context } }, signal))).trim(),
    fix: async (script, error, context, signal) =>
      stripFence(await ask(t => t.send({ kind: 'fix', payload: { script, error, context } }, signal))),
  };
}
