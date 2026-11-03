import type { Stack } from './types.js';
import { deserializeStack } from './serialize.js';

export type FixtureName = 'quiz' | 'adventure' | 'flashcards';

/**
 * Load a bundled sample stack by name.
 * Fixtures are imported as JSON modules (no network request required).
 * The returned Stack is validated against the schema before being returned.
 */
export async function loadFixture(name: FixtureName): Promise<Stack> {
  let json: unknown;
  switch (name) {
    case 'quiz':
      json = (await import('../../fixtures/quiz.necrocard.json')).default;
      break;
    case 'adventure':
      json = (await import('../../fixtures/adventure.necrocard.json')).default;
      break;
    case 'flashcards':
      json = (await import('../../fixtures/flashcards.necrocard.json')).default;
      break;
  }
  return deserializeStack(JSON.stringify(json));
}
