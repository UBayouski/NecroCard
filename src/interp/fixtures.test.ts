import { describe, it, expect } from 'vitest';
import { parse } from './parser.js';
import { parseNotes } from './notes.js';
import quiz from '../../fixtures/quiz.necrocard.json';
import adventure from '../../fixtures/adventure.necrocard.json';
import flashcards from '../../fixtures/flashcards.necrocard.json';

interface ScriptHolder { script: string; objects?: ScriptHolder[] }
interface FixtureStack {
  script: string;
  backgrounds: ScriptHolder[];
  cards: ScriptHolder[];
}

/** Collect every non-empty script in a stack (stack, backgrounds, cards, objects). */
function collectScripts(stack: FixtureStack): string[] {
  const scripts = [stack.script];
  for (const holder of [...stack.backgrounds, ...stack.cards]) {
    scripts.push(holder.script);
    for (const obj of holder.objects ?? []) scripts.push(obj.script);
  }
  return scripts.filter(s => s.trim().length > 0);
}

describe('fixture scripts parse under NecroTalk', () => {
  const fixtures = { quiz, adventure, flashcards } as Record<string, FixtureStack>;
  for (const [name, stack] of Object.entries(fixtures)) {
    it(`every script in ${name}.necrocard.json parses`, () => {
      const scripts = collectScripts(stack);
      expect(scripts.length).toBeGreaterThan(0);
      for (const src of scripts) {
        expect(() => parse(src)).not.toThrow();
      }
    });

    it(`every play notes string in ${name}.necrocard.json parses (necrotalk-play REQ-7.4)`, () => {
      const notes = collectScripts(stack)
        .flatMap(src => [...src.matchAll(/play (?:tempo \d+ )?"([^"]*)"/g)].map(m => m[1]));
      for (const n of notes) expect(() => parseNotes(n)).not.toThrow();
    });
  }

  it('the quiz has a play line (sound was added)', () => {
    const notes = collectScripts(quiz as FixtureStack)
      .flatMap(src => [...src.matchAll(/play (?:tempo \d+ )?"([^"]*)"/g)].map(m => m[1]));
    expect(notes.length).toBeGreaterThan(0);
  });
});
