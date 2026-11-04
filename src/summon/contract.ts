// The browser ↔ server JSON contract for Summon (summon design, "Browser ↔ server JSON contract").
// Shared by the server, the server transport and the direct transport. Pure: no browser or Node globals.
import type { ScriptContext, ScriptOwnerType } from './agentClient.js';

export type SummonRequest =
  | { kind: 'summon'; payload: { prompt: string } }
  | { kind: 'retry'; payload: { prompt: string; previous: string; errors: string[] } }
  | { kind: 'explain'; payload: { script: string; context: ScriptContext } }
  | { kind: 'fix'; payload: { script: string; error: string | null; context: ScriptContext } };

export type SummonKind = SummonRequest['kind'];

/** Every `error.kind` the server can send. */
export type ServerErrorKind =
  | 'bad_request' | 'forbidden' | 'not_found' | 'method' | 'too_large' | 'cap'
  | 'not_configured' | 'quota' | 'auth' | 'safety' | 'network' | 'upstream';

export type SummonResponse =
  | { ok: true; text: string }
  | { ok: false; error: { kind: ServerErrorKind; message: string } };

export interface HealthResponse {
  ok: boolean;
  model: string;
  remainingDay: number;
}

export const LIMITS = {
  prompt: 2000,
  previous: 48000,
  errors: 40,
  errorLine: 400,
  script: 20000,
  error: 400,
  contextName: 200,
  contextObjects: 200,
  bodyBytes: 65536,
} as const;

export const HEADER_REMAINING_DAY = 'X-Summon-Remaining-Day';
export const HEADER_REMAINING_IP = 'X-Summon-Remaining-Ip';

export const SUMMON_PATH = '/api/summon';
export const HEALTH_PATH = '/api/health';

export const SERVER_ERROR_KINDS: readonly ServerErrorKind[] = [
  'bad_request', 'forbidden', 'not_found', 'method', 'too_large', 'cap',
  'not_configured', 'quota', 'auth', 'safety', 'network', 'upstream',
];

const OWNER_TYPES: readonly ScriptOwnerType[] = ['button', 'field', 'image', 'card', 'background', 'stack'];
const OBJECT_TYPES = ['button', 'field', 'image'] as const;

export type ParseResult = { ok: true; request: SummonRequest } | { ok: false; problems: string[] };

type Obj = Record<string, unknown>;

const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates an untrusted request body against the contract and the size limits. */
export function parseSummonRequest(value: unknown): ParseResult {
  const problems: string[] = [];
  if (!isObject(value)) return { ok: false, problems: ['The request must be a JSON object'] };
  onlyKeys(value, ['kind', 'payload'], 'The request', problems);
  const { kind, payload } = value;
  if (!isObject(payload)) {
    problems.push('payload must be an object');
    return { ok: false, problems };
  }
  switch (kind) {
    case 'summon':
      onlyKeys(payload, ['prompt'], 'payload', problems);
      prompt(payload.prompt, problems);
      break;
    case 'retry':
      onlyKeys(payload, ['prompt', 'previous', 'errors'], 'payload', problems);
      prompt(payload.prompt, problems);
      text(payload.previous, 'payload.previous', LIMITS.previous, problems);
      errorList(payload.errors, problems);
      break;
    case 'explain':
      onlyKeys(payload, ['script', 'context'], 'payload', problems);
      text(payload.script, 'payload.script', LIMITS.script, problems);
      context(payload.context, problems);
      break;
    case 'fix':
      onlyKeys(payload, ['script', 'error', 'context'], 'payload', problems);
      text(payload.script, 'payload.script', LIMITS.script, problems);
      if (payload.error !== null) text(payload.error, 'payload.error', LIMITS.error, problems);
      context(payload.context, problems);
      break;
    default:
      problems.push('kind must be one of summon, retry, explain, fix');
  }
  return problems.length ? { ok: false, problems } : { ok: true, request: value as SummonRequest };
}

function onlyKeys(value: Obj, allowed: readonly string[], where: string, problems: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) problems.push(`${where} has an unknown key "${clip(key)}"`);
  }
}

function text(value: unknown, where: string, max: number, problems: string[]): void {
  if (typeof value !== 'string') problems.push(`${where} must be a string`);
  else if (value.length > max) problems.push(`${where} must be at most ${max} characters`);
}

function prompt(value: unknown, problems: string[]): void {
  text(value, 'payload.prompt', LIMITS.prompt, problems);
  if (typeof value === 'string' && value.trim() === '') problems.push('payload.prompt must not be empty');
}

function errorList(value: unknown, problems: string[]): void {
  if (!Array.isArray(value)) {
    problems.push('payload.errors must be an array');
    return;
  }
  if (value.length > LIMITS.errors) problems.push(`payload.errors must have at most ${LIMITS.errors} items`);
  value.forEach((e, i) => text(e, `payload.errors[${i}]`, LIMITS.errorLine, problems));
}

function context(value: unknown, problems: string[]): void {
  if (!isObject(value)) {
    problems.push('payload.context must be an object');
    return;
  }
  onlyKeys(value, ['owner', 'stackName', 'cardName', 'backgroundName', 'objectNames'], 'payload.context', problems);
  const { owner, stackName, cardName, backgroundName, objectNames } = value;
  if (!isObject(owner)) {
    problems.push('payload.context.owner must be an object');
  } else {
    onlyKeys(owner, ['type', 'name'], 'payload.context.owner', problems);
    if (!OWNER_TYPES.includes(owner.type as ScriptOwnerType)) {
      problems.push(`payload.context.owner.type must be one of ${OWNER_TYPES.join(', ')}`);
    }
    text(owner.name, 'payload.context.owner.name', LIMITS.contextName, problems);
  }
  text(stackName, 'payload.context.stackName', LIMITS.contextName, problems);
  if (cardName !== null) text(cardName, 'payload.context.cardName', LIMITS.contextName, problems);
  if (backgroundName !== null) {
    text(backgroundName, 'payload.context.backgroundName', LIMITS.contextName, problems);
  }
  if (!Array.isArray(objectNames)) {
    problems.push('payload.context.objectNames must be an array');
    return;
  }
  if (objectNames.length > LIMITS.contextObjects) {
    problems.push(`payload.context.objectNames must have at most ${LIMITS.contextObjects} items`);
  }
  objectNames.forEach((o, i) => {
    const where = `payload.context.objectNames[${i}]`;
    if (!isObject(o)) {
      problems.push(`${where} must be an object`);
      return;
    }
    onlyKeys(o, ['type', 'name'], where, problems);
    if (!OBJECT_TYPES.includes(o.type as (typeof OBJECT_TYPES)[number])) {
      problems.push(`${where}.type must be one of ${OBJECT_TYPES.join(', ')}`);
    }
    text(o.name, `${where}.name`, LIMITS.contextName, problems);
  });
}

/** Keys from untrusted input are echoed in problems; keep them short. */
function clip(s: string): string {
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}
