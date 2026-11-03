import { NecroTalkError, formatError } from './errors.js';
import type { GoTarget } from './ast.js';

/**
 * Resolve a NecroTalk navigation target to a 0-based card index.
 *
 * - next/prev wrap around (HyperCard behaviour).
 * - Card names are matched case-insensitively.
 * - Out-of-range numeric indices and unknown names throw NecroTalkError.
 *
 * @param target    The parsed GoTarget from a GoStatement.
 * @param currentIndex  Current card index (0-based).
 * @param cardCount     Total number of cards in the stack.
 * @param cardNames     Card names in order (index 0 = first card).
 * @param sourceLine    Line number of the GoStatement for error reporting.
 */
export function resolveNavigation(
  target: GoTarget,
  currentIndex: number,
  cardCount: number,
  cardNames: string[],
  sourceLine = 0,
): number {
  if (cardCount < 1) {
    throw new NecroTalkError(formatError(sourceLine, 1, 'The stack has no cards'), sourceLine, 1);
  }
  switch (target.type) {
    case 'next':
      return (currentIndex + 1) % cardCount;
    case 'prev':
      return (currentIndex - 1 + cardCount) % cardCount;
    case 'first':
      return 0;
    case 'last':
      return cardCount - 1;
    case 'card': {
      if (typeof target.value === 'number') {
        const n = target.value; // 1-based
        if (!Number.isInteger(n)) {
          throw new NecroTalkError(
            formatError(sourceLine, 1, `Card number ${n} is not a whole number`),
            sourceLine, 1,
          );
        }
        if (n < 1 || n > cardCount) {
          throw new NecroTalkError(
            formatError(sourceLine, 1, `Card index ${n} is out of range`),
            sourceLine, 1,
          );
        }
        return n - 1;
      } else {
        // string name — case-insensitive search
        const lower = target.value.toLowerCase();
        const idx = cardNames.findIndex(name => name.toLowerCase() === lower);
        if (idx === -1) {
          throw new NecroTalkError(
            formatError(sourceLine, 1, `No card named "${target.value}"`),
            sourceLine, 1,
          );
        }
        return idx;
      }
    }
  }
}
