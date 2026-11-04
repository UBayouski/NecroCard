import { describe, expect, it } from 'vitest';
import { applyCommand, CommandError, describeCommand, invertCommand, type Command } from './commands.js';
import { loadFixture } from '../../model/fixtures.js';
import { serializeStack } from '../../model/serialize.js';
import { validateStack } from '../../model/validate.js';
import type { Stack } from '../../model/types.js';

async function quiz(): Promise<Stack> {
  return loadFixture('quiz');
}

/** One command of every kind against the quiz fixture, on both the card and the background layers. */
function everyKind(s: Stack): Command[] {
  const card = s.cards[1];
  const btn = card.objects[1];
  const cardTarget = { kind: 'card' as const, cardId: card.id };
  const bg = s.backgrounds.find(b => b.id === card.backgroundId)!;
  const bgTarget = { kind: 'background' as const, backgroundId: bg.id };
  const newCard = { id: 'newcard001', name: 'Extra', backgroundId: card.backgroundId, objects: [], script: '' };
  const newObj = {
    id: 'newobj0001', name: 'Field 1', type: 'field' as const, rect: { x: 1, y: 2, w: 30, h: 40 },
    visible: true, script: '', text: '', lockText: false, style: 'rect' as const,
  };
  const bgObj = {
    id: 'bgobj00001', name: 'Shared', type: 'button' as const, rect: { x: 3, y: 4, w: 50, h: 20 },
    visible: true, script: '', style: 'roundRect' as const, label: 'Shared', autoHilite: true,
  };
  return [
    { kind: 'setRect', target: cardTarget, objectId: btn.id, before: structuredClone(btn.rect), after: { x: 5, y: 6, w: 70, h: 8 }, reason: 'move' },
    { kind: 'setProp', target: cardTarget, objectId: btn.id, prop: 'label', before: 'A) A zombie', after: 'Changed' },
    { kind: 'setProp', target: cardTarget, objectId: btn.id, prop: 'style', before: 'rect', after: 'transparent' },
    { kind: 'setProp', target: cardTarget, objectId: btn.id, prop: 'visible', before: true, after: false },
    { kind: 'setScript', owner: { kind: 'object', target: cardTarget, objectId: btn.id }, before: btn.script, after: 'on mouseUp\nend mouseUp' },
    { kind: 'setScript', owner: { kind: 'card', cardId: card.id }, before: '', after: 'on openCard\nend openCard' },
    { kind: 'setScript', owner: { kind: 'background', backgroundId: card.backgroundId }, before: '', after: '-- bg' },
    { kind: 'setScript', owner: { kind: 'stack' }, before: '', after: '-- stack' },
    { kind: 'addObject', target: cardTarget, index: 1, object: newObj },
    { kind: 'removeObject', target: cardTarget, index: 0, object: structuredClone(card.objects[0]) },
    // Background-layer object commands (edit-background REQ-5.1): add one, then act on it.
    { kind: 'addObject', target: bgTarget, index: bg.objects.length, object: bgObj },
    { kind: 'insertCard', index: 2, card: newCard },
    { kind: 'removeCard', index: 4, card: structuredClone(s.cards[4]) },
    { kind: 'renameCard', cardId: card.id, before: 'Q1', after: 'First' },
    { kind: 'renameStack', before: s.name, after: 'Renamed' },
  ];
}

describe('applyCommand / invertCommand', () => {
  it('every command kind: apply keeps the stack valid, apply(invert) restores it byte for byte', async () => {
    const original = await quiz();
    for (const cmd of everyKind(original)) {
      const s = structuredClone(original);
      const before = serializeStack(s);
      applyCommand(s, cmd);
      validateStack(s);
      expect(serializeStack(s)).not.toBe(before);
      applyCommand(s, invertCommand(cmd));
      expect(serializeStack(s)).toBe(before);
    }
  });

  it('mutating the working copy never reaches the object stored in the command', async () => {
    const s = await quiz();
    const obj = {
      id: 'isolated01', name: 'Image 1', type: 'image' as const, rect: { x: 0, y: 0, w: 8, h: 8 },
      visible: true, script: '', src: 'asset',
    };
    const cmd: Command = { kind: 'addObject', target: { kind: 'card', cardId: s.cards[0].id }, index: 0, object: obj };
    applyCommand(s, cmd);
    expect(s.cards[0].objects[0]).not.toBe(obj);
    s.cards[0].objects[0].name = 'mutated';
    s.cards[0].objects[0].rect.x = 99;
    expect(obj.name).toBe('Image 1');
    expect(obj.rect.x).toBe(0);
    applyCommand(s, invertCommand(cmd));
    applyCommand(s, cmd); // redo re-adds the original values
    expect(s.cards[0].objects[0].name).toBe('Image 1');
  });

  it('rejects properties the object type does not have, and bad values', async () => {
    const s = await quiz();
    const card = s.cards[1];
    const field = card.objects[0];
    const btn = card.objects[1];
    const snapshot = serializeStack(s);
    const bad: Command[] = [
      { kind: 'setProp', target: { kind: 'card', cardId: card.id }, objectId: field.id, prop: 'label', before: '', after: 'x' },
      { kind: 'setProp', target: { kind: 'card', cardId: card.id }, objectId: btn.id, prop: 'style', before: 'rect', after: 'scrolling' },
      { kind: 'setProp', target: { kind: 'card', cardId: card.id }, objectId: btn.id, prop: 'visible', before: true, after: 'no' },
      { kind: 'setProp', target: { kind: 'card', cardId: card.id }, objectId: btn.id, prop: 'src', before: '', after: 'x' },
    ];
    for (const cmd of bad) expect(() => applyCommand(s, cmd)).toThrow(CommandError);
    expect(serializeStack(s)).toBe(snapshot);
  });

  it('missing targets and moved items throw and change nothing', async () => {
    const s = await quiz();
    const snapshot = serializeStack(s);
    const card = s.cards[1];
    const cases: Command[] = [
      { kind: 'setRect', target: { kind: 'card', cardId: 'nocard0001' }, objectId: 'x', before: { x: 0, y: 0, w: 1, h: 1 }, after: { x: 1, y: 1, w: 1, h: 1 }, reason: 'move' },
      { kind: 'setRect', target: { kind: 'card', cardId: card.id }, objectId: 'noobject01', before: { x: 0, y: 0, w: 1, h: 1 }, after: { x: 1, y: 1, w: 1, h: 1 }, reason: 'move' },
      { kind: 'setRect', target: { kind: 'background', backgroundId: 'nobg000001' }, objectId: 'x', before: { x: 0, y: 0, w: 1, h: 1 }, after: { x: 1, y: 1, w: 1, h: 1 }, reason: 'move' },
      { kind: 'removeObject', target: { kind: 'card', cardId: card.id }, index: 0, object: structuredClone(card.objects[1]) },
      { kind: 'removeCard', index: 0, card: structuredClone(s.cards[1]) },
      { kind: 'addObject', target: { kind: 'card', cardId: card.id }, index: 99, object: structuredClone(card.objects[1]) },
      { kind: 'addObject', target: { kind: 'background', backgroundId: 'nobg000001' }, index: 0, object: structuredClone(card.objects[1]) },
      { kind: 'setScript', owner: { kind: 'background', backgroundId: 'nobg000001' }, before: '', after: 'x' },
      { kind: 'setScript', owner: { kind: 'object', target: { kind: 'background', backgroundId: 'nobg000001' }, objectId: 'x' }, before: '', after: 'y' },
    ];
    for (const cmd of cases) expect(() => applyCommand(s, cmd)).toThrow(CommandError);
    expect(serializeStack(s)).toBe(snapshot);
  });

  it('never removes the last card', async () => {
    const s = await quiz();
    s.cards.splice(1);
    expect(() => applyCommand(s, { kind: 'removeCard', index: 0, card: structuredClone(s.cards[0]) }))
      .toThrow('A stack needs at least one card');
  });

  it('describes commands for undo/redo titles', async () => {
    const s = await quiz();
    const [move, label] = everyKind(s);
    expect(describeCommand(move, s)).toBe('Move button "AnswerA"');
    expect(describeCommand(label, s)).toBe('Change label of button "AnswerA"');
    expect(describeCommand({ kind: 'renameStack', before: 'a', after: 'b' }, s)).toBe('Rename Stack');
  });

  it('labels a background-layer object command with a "(background)" suffix', async () => {
    const s = await quiz();
    const bg = s.backgrounds.find(b => b.id === s.cards[1].backgroundId)!;
    const bgObj = {
      id: 'bgobj00001', name: 'Shared', type: 'button' as const, rect: { x: 0, y: 0, w: 10, h: 10 },
      visible: true, script: '', style: 'roundRect' as const, label: 'Shared', autoHilite: true,
    };
    bg.objects.push(bgObj);
    const move: Command = {
      kind: 'setRect', target: { kind: 'background', backgroundId: bg.id }, objectId: bgObj.id,
      before: bgObj.rect, after: { x: 5, y: 5, w: 10, h: 10 }, reason: 'move',
    };
    expect(describeCommand(move, s)).toBe('Move button "Shared" (background)');
  });
});
