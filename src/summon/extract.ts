// Find the stack JSON object in a model reply (summon design, "Extraction").

export type Extracted = { value: Record<string, unknown> } | { error: string };

const NOT_OBJECT = 'Reply was not a JSON object';
const NOT_JSON = 'Reply was not valid JSON';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

type Attempt = { value: unknown } | null;

function tryParse(text: string): Attempt {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return null;
  }
}

/** Index just past the `}` that closes the `{` at `start`, skipping braces inside JSON strings; -1 if unbalanced. */
export function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * If the whole reply parses as JSON, it decides. Otherwise the first fenced code block, then the first balanced
 * `{…}`: the first that parses to an object wins; if some parsed but none is an object, the reply is
 * "not a JSON object".
 */
export function extractJsonObject(text: string): Extracted {
  const whole = tryParse(text.trim());
  if (whole) return isObject(whole.value) ? { value: whole.value } : { error: NOT_OBJECT };
  const candidates: string[] = [];
  const fence = /```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)```/.exec(text);
  if (fence) candidates.push(fence[1].trim());
  const open = text.indexOf('{');
  if (open >= 0) {
    const end = balancedEnd(text, open);
    if (end > 0) candidates.push(text.slice(open, end));
  }
  let parsedSomething = false;
  for (const candidate of candidates) {
    const parsed = tryParse(candidate);
    if (!parsed) continue;
    if (isObject(parsed.value)) return { value: parsed.value };
    parsedSomething = true;
  }
  return { error: open >= 0 && !parsedSomething ? NOT_JSON : NOT_OBJECT };
}
