import type { Stack } from './types.js';
import { validateStack } from './validate.js';

/**
 * Replacer that sorts object keys alphabetically at every level.
 * Arrays are not reordered — array order is significant (card order, object order).
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    );
  }
  return value;
}

/**
 * Serialize a Stack to a canonical JSON string.
 * Keys are sorted alphabetically at every object level; arrays preserve order.
 * Two deep-equal Stack values always produce identical strings.
 */
export function serializeStack(stack: Stack): string {
  return JSON.stringify(stack, sortedReplacer, 2);
}

/**
 * Deserialize and validate a JSON string into a typed Stack.
 * Throws SyntaxError if the JSON is malformed.
 * Throws ValidationError if the parsed value fails schema validation.
 */
export function deserializeStack(json: string): Stack {
  const parsed: unknown = JSON.parse(json);
  return validateStack(parsed);
}
