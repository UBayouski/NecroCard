import type { Stack } from '../../model/types.js';
import { generateId } from '../../model/id.js';
import { validateStack } from '../../model/validate.js';

/**
 * A new, empty stack (REQ-1.5): one background "Background 1", one empty card "Card 1" on it,
 * name "Untitled", empty scripts, created = modified = now, no author. Validated before return.
 */
export function createNewStack(now: Date = new Date(), idGen: () => string = generateId): Stack {
  const ids = new Set<string>();
  const fresh = () => {
    for (let i = 0; i < 1000; i++) {
      const id = idGen();
      if (!ids.has(id)) { ids.add(id); return id; }
    }
    throw new Error('Could not generate a unique id');
  };
  const stackId = fresh();
  const backgroundId = fresh();
  const cardId = fresh();
  const stamp = now.toISOString();
  return validateStack({
    id: stackId,
    name: 'Untitled',
    backgrounds: [{ id: backgroundId, name: 'Background 1', objects: [], script: '' }],
    cards: [{ id: cardId, name: 'Card 1', backgroundId, objects: [], script: '' }],
    script: '',
    metadata: { created: stamp, modified: stamp, author: '' },
  });
}
