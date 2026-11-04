import { describe, expect, it } from 'vitest';
import adventure from '../../fixtures/adventure.necrocard.json' with { type: 'json' };
import flashcards from '../../fixtures/flashcards.necrocard.json' with { type: 'json' };
import quiz from '../../fixtures/quiz.necrocard.json' with { type: 'json' };
import type { ButtonObject, ImageObject, Stack } from '../model/types.js';
import { checkIntegrity, scriptsOf } from './integrity.js';

const fixtures = [quiz, adventure, flashcards] as unknown as Stack[];
const button = (id: string, name: string, script = ''): ButtonObject => ({
  id, name, type: 'button', rect: { x: 0, y: 0, w: 10, h: 10 }, visible: true, script,
  style: 'rect', label: name, autoHilite: true,
});

function tiny(): Stack {
  return {
    id: 'stack0001', name: 'S', script: 'on openStack\nend openStack',
    metadata: { created: '2026-11-03T14:00:00.000Z', modified: '2026-11-03T14:00:00.000Z', author: '' },
    backgrounds: [{ id: 'bkgnd001', name: 'B', script: '', objects: [button('bgbtn001', 'Home', 'on mouseUp\nend mouseUp')] }],
    cards: [{ id: 'card0001', name: 'C', backgroundId: 'bkgnd001', script: ' \n ', objects: [button('cdbtn001', 'Go', 'x')] }],
  };
}

describe('checkIntegrity', () => {
  it.each(fixtures.map(f => [f.name, f]))('the fixture %s passes', (_name, stack) => {
    expect(checkIntegrity(stack as Stack)).toEqual([]);
  });

  it('requires a background and a card', () => {
    const s = { ...tiny(), backgrounds: [], cards: [] };
    expect(checkIntegrity(s)).toEqual(['The stack has no backgrounds', 'The stack has no cards']);
  });

  it('reports a duplicate id with every owner', () => {
    const s = tiny();
    s.cards[0].objects[0].id = 'bkgnd001';
    expect(checkIntegrity(s)).toEqual([
      'Id "bkgnd001" is used more than once: background "B", button "Go" on card "C"',
    ]);
  });

  it('reports a dangling backgroundId', () => {
    const s = tiny();
    s.cards[0].backgroundId = 'zzzzzzzz';
    expect(checkIntegrity(s)).toEqual(['Card "C": backgroundId "zzzzzzzz" does not match any background']);
  });

  it('rejects image objects', () => {
    const s = tiny();
    const image: ImageObject = {
      id: 'image001', name: 'Moon', type: 'image', rect: { x: 0, y: 0, w: 1, h: 1 }, visible: true, script: '', src: '',
    };
    s.backgrounds[0].objects.push(image);
    expect(checkIntegrity(s)).toEqual(['Image "Moon" on background "B": image objects are not allowed in Summon']);
  });
});

describe('scriptsOf', () => {
  it('lists non-empty scripts in order with owner descriptions', () => {
    expect(scriptsOf(tiny())).toEqual([
      { where: 'Script of stack "S"', script: 'on openStack\nend openStack' },
      { where: 'Script of button "Home" on background "B"', script: 'on mouseUp\nend mouseUp' },
      { where: 'Script of button "Go" on card "C"', script: 'x' },
    ]);
  });
});
