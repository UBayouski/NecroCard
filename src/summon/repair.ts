// Repairs ids in a Summon reply before schema validation (summon hardening). Models sometimes write an id that
// is a readable word ("stkHalloween", too long) or a padded placeholder ("fdWord1___"); the retry then repeats
// the same mistake because the schema error for it is one line buried in a 10-line oneOf cascade (see
// pipeline.ts schemaErrors). Fixing it here, deterministically and before validation, means a reply whose only
// fault is its ids loads without ever needing a retry.
//
// Pure: no browser or Node globals, no randomness. The same bad id always repairs to the same good id, so a
// replaced backgroundId can be found again by recomputing it from the original (unrepaired) background id.

const ID_PATTERN = /^[A-Za-z0-9_-]{8,10}$/;
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A short stable digest of a string, as base-62-ish digits over ID_CHARS. FNV-1a, not cryptographic — ids only
 *  need to be deterministic and well spread, not secure. */
function hashOf(input: string, length: number): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Mix a second time so the low bits (used first) are not dominated by the last character alone.
  let h2 = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h2 ^= h2 >>> 13;
  let out = '';
  // h and h2 together give 64 bits of material, enough for up to 10 base-62 digits with room to spare.
  let bits = (BigInt(h >>> 0) << 32n) | BigInt(h2 >>> 0);
  const base = BigInt(ID_CHARS.length);
  for (let i = 0; i < length; i++) {
    out += ID_CHARS[Number(bits % base)];
    bits /= base;
  }
  return out;
}

/** Deterministic replacement id for a given (invalid or duplicate) original id and a two-letter place prefix.
 *  Total length is fixed at 9 (prefix + 7 hash digits), comfortably inside the schema's 8–10 range. */
function repairedId(prefix: string, original: string): string {
  return `${prefix}${hashOf(original, 9 - prefix.length)}`;
}

/** True when `value` is a usable id: a string matching the id pattern. */
function isValidId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/**
 * Walk a Summon reply's stack/background/card/object ids. Any id that is missing, not a string, not matching
 * the id pattern, or a repeat of an id already seen, is replaced by a deterministic id built from a two-letter
 * place prefix (`stk`, `bg`, `cd`, `fd`, `bt`, `im`) and a short hash of the original value, so the same bad
 * input always repairs to the same output and distinct bad inputs essentially never collide. Every
 * `backgroundId` that pointed at a background id we replaced is rewritten to match. Nothing else is touched:
 * callers still run the full schema and integrity checks afterwards.
 */
export function repairIds(value: unknown): unknown {
  if (!isObject(value)) return value;
  const seen = new Set<string>();
  const bgRename = new Map<string, string>(); // original (possibly invalid) background id -> repaired id

  function nextId(prefix: string, original: unknown): string {
    const originalStr = typeof original === 'string' ? original : JSON.stringify(original ?? '');
    let candidate = isValidId(original) && !seen.has(original) ? original : repairedId(prefix, originalStr);
    // Pathological case: the hash itself collides with something already seen. Re-hash with a salt until unique.
    let salt = 0;
    while (seen.has(candidate)) {
      salt++;
      candidate = repairedId(prefix, `${originalStr}\u0000${salt}`);
    }
    seen.add(candidate);
    return candidate;
  }

  function repairObject(obj: unknown): unknown {
    if (!isObject(obj)) return obj;
    const prefix = obj.type === 'button' ? 'bt' : obj.type === 'image' ? 'im' : 'fd';
    return { ...obj, id: nextId(prefix, obj.id) };
  }

  function repairObjects(objects: unknown): unknown {
    return Array.isArray(objects) ? objects.map(repairObject) : objects;
  }

  const stack = { ...value };
  stack.id = nextId('stk', (value as Record<string, unknown>).id);

  if (Array.isArray(stack.backgrounds)) {
    stack.backgrounds = stack.backgrounds.map(bg => {
      if (!isObject(bg)) return bg;
      const original = bg.id;
      const repaired = nextId('bg', original);
      if (typeof original === 'string' && !bgRename.has(original)) bgRename.set(original, repaired);
      return { ...bg, id: repaired, objects: repairObjects(bg.objects) };
    });
  }

  if (Array.isArray(stack.cards)) {
    stack.cards = stack.cards.map(card => {
      if (!isObject(card)) return card;
      const rewritten: Record<string, unknown> = { ...card, id: nextId('cd', card.id), objects: repairObjects(card.objects) };
      if (typeof card.backgroundId === 'string' && bgRename.has(card.backgroundId)) {
        rewritten.backgroundId = bgRename.get(card.backgroundId);
      }
      return rewritten;
    });
  }

  return stack;
}
