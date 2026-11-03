import { describe, it, expect } from 'vitest';
import { deserializeStack } from './serialize.js';
import { loadFixture } from './fixtures.js';
import { validateStack } from './validate.js';
import quizJson from '../../fixtures/quiz.necrocard.json';
import adventureJson from '../../fixtures/adventure.necrocard.json';
import flashcardsJson from '../../fixtures/flashcards.necrocard.json';

const fixtures = [
  { name: 'quiz', json: quizJson },
  { name: 'adventure', json: adventureJson },
  { name: 'flashcards', json: flashcardsJson },
] as const;

describe('fixture files', () => {
  for (const { name, json } of fixtures) {
    it(`${name}.necrocard.json passes validateStack`, () => {
      expect(() => deserializeStack(JSON.stringify(json))).not.toThrow();
    });

    it(`${name}.necrocard.json round-trips losslessly`, () => {
      const stack = deserializeStack(JSON.stringify(json));
      const restored = deserializeStack(JSON.stringify(stack));
      expect(restored).toEqual(stack);
    });
  }
});

describe('loadFixture', () => {
  it('loads quiz and passes validateStack', async () => {
    const stack = await loadFixture('quiz');
    expect(() => validateStack(stack)).not.toThrow();
    expect(stack.name).toBe('The Haunted Quiz');
  });

  it('loads adventure and passes validateStack', async () => {
    const stack = await loadFixture('adventure');
    expect(() => validateStack(stack)).not.toThrow();
    expect(stack.name).toBe('The Cursed Manor');
  });

  it('loads flashcards and passes validateStack', async () => {
    const stack = await loadFixture('flashcards');
    expect(() => validateStack(stack)).not.toThrow();
    expect(stack.name).toBe('Spooky Flashcards');
  });
});
