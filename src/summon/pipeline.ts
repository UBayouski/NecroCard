// The Summon pipeline (summon REQ-3): request → extract → validate → integrity → parse every script →
// one retry with the error list → stack or SummonError. Pure over the injected transport.
import type { ErrorObject } from 'ajv';
import { parse } from '../interp/parser.js';
import type { Stack } from '../model/types.js';
import { validateStack, ValidationError } from '../model/validate.js';
import { LIMITS } from './contract.js';
import { extractJsonObject } from './extract.js';
import { checkIntegrity, scriptsOf } from './integrity.js';
import type { Transport, TransportReply } from './transport.js';

export type SummonProgress = 'summoning' | 'validating' | 'retrying';

export interface SummonOptions {
  signal?: AbortSignal;
  onProgress?(progress: SummonProgress): void;
  /** Every transport reply, e.g. for the server's remaining counts. */
  onReply?(reply: TransportReply): void;
}

export class SummonError extends Error {
  constructor(readonly failures: string[]) {
    super(`Summon failed:\n${failures.join('\n')}`);
    this.name = 'SummonError';
  }
}

export const MAX_SCHEMA_ERRORS = 20;

export type CheckResult = { stack: Stack } | { errors: string[] };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

function describeSchemaError(e: ErrorObject): string {
  const path = e.instancePath || '(root)';
  const params = e.params as Record<string, unknown>;
  const extra = params.additionalProperty ?? params.unevaluatedProperty;
  return `Schema: ${path} ${e.message ?? 'is invalid'}${typeof extra === 'string' ? ` ("${extra}")` : ''}`;
}

function schemaErrors(e: unknown): string[] {
  if (!(e instanceof ValidationError)) return [`Schema: ${messageOf(e)}`];
  const lines = [...new Set(e.errors.map(describeSchemaError))];
  if (lines.length === 0) return ['Schema: the stack does not match the schema'];
  return lines.length > MAX_SCHEMA_ERRORS
    ? [...lines.slice(0, MAX_SCHEMA_ERRORS), `Schema: …and ${lines.length - MAX_SCHEMA_ERRORS} more`]
    : lines;
}

/** Everything that decides whether a reply is a loadable stack. */
export function checkReply(text: string): CheckResult {
  const extracted = extractJsonObject(text);
  if ('error' in extracted) return { errors: [extracted.error] };
  let stack: Stack;
  try {
    stack = validateStack(extracted.value);
  } catch (e) {
    return { errors: schemaErrors(e) };
  }
  const errors = checkIntegrity(stack);
  for (const site of scriptsOf(stack)) {
    try {
      parse(site.script);
    } catch (e) {
      errors.push(`${site.where}: ${messageOf(e)}`);
    }
  }
  return errors.length ? { errors } : { stack };
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** The error list as sent in a retry: each line and the count within LIMITS. */
export function retryErrors(errors: readonly string[]): string[] {
  const lines = errors.map(e => clip(e, LIMITS.errorLine));
  if (lines.length <= LIMITS.errors) return lines;
  const kept = lines.slice(0, LIMITS.errors - 1);
  return [...kept, `…and ${lines.length - kept.length} more`];
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The request was cancelled', 'AbortError');
}

/** Summon one stack. Transport errors propagate unchanged and are not retried. */
export async function summonStack(prompt: string, transport: Transport, options: SummonOptions = {}): Promise<Stack> {
  const { signal, onProgress, onReply } = options;
  const description = prompt.trim();
  if (description === '' || description.length > LIMITS.prompt) {
    throw new SummonError([`The description must be 1 to ${LIMITS.prompt} characters`]);
  }
  throwIfAborted(signal);

  onProgress?.('summoning');
  const first = await transport.send({ kind: 'summon', payload: { prompt: description } }, signal);
  onReply?.(first);
  throwIfAborted(signal);
  onProgress?.('validating');
  const checked = checkReply(first.text);
  if ('stack' in checked) return checked.stack;

  onProgress?.('retrying');
  const retry = await transport.send(
    {
      kind: 'retry',
      payload: { prompt: description, previous: clip(first.text, LIMITS.previous), errors: retryErrors(checked.errors) },
    },
    signal,
  );
  onReply?.(retry);
  throwIfAborted(signal);
  onProgress?.('validating');
  const rechecked = checkReply(retry.text);
  if ('stack' in rechecked) return rechecked.stack;
  throw new SummonError(rechecked.errors);
}
