// Short URL-safe random id generation.
// Uses crypto.getRandomValues (available in Node 22+ and all modern browsers).

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
// ALPHABET.length === 64, which divides 256 evenly — zero modulo bias.
const ID_LENGTH = 10;

/**
 * Generate a short URL-safe random id.
 * Returns a string of exactly 10 characters from A-Za-z0-9_-.
 * Ids are unique within a stack when generated independently; collision probability
 * is negligible for stacks of a few hundred objects (64^10 ≈ 1.15 × 10^18 possible ids).
 */
export function generateId(): string {
  const bytes = new Uint8Array(ID_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
