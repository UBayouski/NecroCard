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

describe('checkIntegrity: card messages in object scripts', () => {
  const field = (script: string) => ({
    id: 'field0001', name: 'Summary', type: 'field' as const, rect: { x: 0, y: 0, w: 10, h: 10 }, visible: true, script,
    text: '', lockText: true, style: 'rect' as const,
  });

  it('an openCard handler on a card field is an error naming the field, so the retry moves it', () => {
    const s = tiny();
    s.cards[0].objects.push(field('on openCard\n  put "Hi" into field "Summary"\nend openCard'));
    expect(checkIntegrity(s)).toEqual([
      'field "Summary" on card "C": "on openCard" never runs in an object script (openCard goes to the card, '
      + 'background and stack only); move the handler to the card, background or stack script',
    ]);
  });

  it('flags each card-message handler on a background button, case-insensitively, alongside a valid mouseUp', () => {
    const s = tiny();
    s.backgrounds[0].objects[0].script =
      'on mouseUp\n  go next\nend mouseUp\non CLOSECARD\nend CLOSECARD\non openStack\nend openStack';
    const problems = checkIntegrity(s);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^button "Home" on background "B": "on CLOSECARD" never runs/);
    expect(problems[1]).toMatch(/^button "Home" on background "B": "on openStack" never runs/);
  });

  it('openCard, closeCard, openStack and closeStack in card, background and stack scripts are correct', () => {
    const s = tiny();
    s.script = 'on openStack\nend openStack\non closeStack\nend closeStack';
    s.backgrounds[0].script = 'on openCard\nend openCard';
    s.cards[0].script = 'on openCard\n  put "" into field "Summary"\nend openCard\non closeCard\nend closeCard';
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('the reverse direction: a mouse handler on a card is left alone (an unhandled click passes up to it)', () => {
    const s = tiny();
    s.cards[0].script = 'on mouseUp\n  go next\nend mouseUp';
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('reads the AST, not the text: "on openCard" inside a string or comment is not a handler', () => {
    const s = tiny();
    s.cards[0].objects.push(field('on mouseUp\n  -- on openCard\n  put "on openCard" into field "Summary"\nend mouseUp'));
    expect(checkIntegrity(s)).toEqual([]);
  });

  it('an object script that does not parse is left to the parse check', () => {
    const s = tiny();
    s.cards[0].objects.push(field('on openCard\n  put into\nend openCard'));
    expect(checkIntegrity(s)).toEqual([]);
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
