// The Summon pipeline (summon REQ-3): request → extract → validate → integrity → parse every script →
// one retry with the error list → stack or SummonError. Pure over the injected transport.
import type { ErrorObject } from 'ajv';
import { parse } from '../interp/parser.js';
import type { Stack } from '../model/types.js';
import { validateStack, ValidationError } from '../model/validate.js';
import { LIMITS } from './contract.js';
import { extractJsonObject } from './extract.js';
import { checkIntegrity, scriptsOf } from './integrity.js';
import { repairIds } from './repair.js';
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

const BASE_PROPS = ['id', 'name', 'rect', 'visible', 'script'];
/** Properties each object type allows, and requires, beyond the base set (mirrors stack.schema.json). */
const BRANCH: Record<string, { allowed: string[]; required: string[]; styles?: string[] }> = {
  button: { allowed: ['type', 'style', 'label', 'autoHilite'], required: ['type', 'style', 'label', 'autoHilite'], styles: ['rect', 'roundRect', 'transparent'] },
  field: { allowed: ['type', 'text', 'lockText', 'style'], required: ['type', 'text', 'lockText', 'style'], styles: ['rect', 'scrolling', 'transparent'] },
  image: { allowed: ['type', 'src'], required: ['type', 'src'] },
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function valueAt(root: unknown, pointer: string): unknown {
  let cur = root;
  for (const part of pointer.split('/').slice(1)) {
    if (Array.isArray(cur)) cur = cur[Number(part)];
    else if (isRecord(cur)) cur = cur[part];
    else return undefined;
  }
  return cur;
}

/**
 * The CardObject schema is a oneOf over button, field and image, so one fault in one object makes ajv report
 * the failures of all three branches plus the oneOf itself (about ten lines). When the object names its own
 * type, keep only that branch's errors: drop the other branches' `type` constant, missing-property and
 * unexpected-property errors, and the oneOf summary. A bad id then reports as one line.
 */
function inChosenBranch(e: ErrorObject, root: unknown): boolean {
  const m = /^(.*\/objects\/\d+)(\/.*)?$/.exec(e.instancePath);
  if (!m) return true;
  const obj = valueAt(root, m[1]);
  const branch = isRecord(obj) && typeof obj.type === 'string' ? BRANCH[obj.type] : undefined;
  if (!branch) return true;
  const params = e.params as Record<string, unknown>;
  if (e.instancePath === m[1]) {
    if (e.keyword === 'oneOf') return false;
    if (e.keyword === 'required') return BASE_PROPS.includes(String(params.missingProperty)) || branch.required.includes(String(params.missingProperty));
    if (e.keyword === 'unevaluatedProperties') {
      const prop = String(params.unevaluatedProperty);
      return !BASE_PROPS.includes(prop) && !branch.allowed.includes(prop);
    }
  }
  if (e.instancePath === `${m[1]}/type` && e.keyword === 'const') return false;
  // Another branch's style list rejects a style this type allows (a roundRect button fails the field branch).
  if (e.instancePath === `${m[1]}/style` && e.keyword === 'enum' && branch.styles?.includes(String((obj as Record<string, unknown>).style))) return false;
  return true;
}

export function schemaErrors(e: unknown, root?: unknown): string[] {
  if (!(e instanceof ValidationError)) return [`Schema: ${messageOf(e)}`];
  const lines = [...new Set(e.errors.filter(err => inChosenBranch(err, root)).map(describeSchemaError))];
  if (lines.length === 0) return ['Schema: the stack does not match the schema'];
  return lines.length > MAX_SCHEMA_ERRORS
    ? [...lines.slice(0, MAX_SCHEMA_ERRORS), `Schema: …and ${lines.length - MAX_SCHEMA_ERRORS} more`]
    : lines;
}

/** Everything that decides whether a reply is a loadable stack. */
export function checkReply(text: string): CheckResult {
  const extracted = extractJsonObject(text);
  if ('error' in extracted) return { errors: [extracted.error] };
  const repaired = repairIds(extracted.value);
  let stack: Stack;
  try {
    stack = validateStack(repaired);
  } catch (e) {
    return { errors: schemaErrors(e, repaired) };
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
