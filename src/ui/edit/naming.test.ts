import { describe, expect, it } from 'vitest';
import { uniqueCardName, uniqueId, uniqueObjectName, usedIds } from './naming.js';
import { centredRect, defaultRect, makeButton, makeField, makeImage } from './objectFactory.js';
import { createNewStack } from './newStack.js';
import { background, button, field, makeStack } from '../browse/testStacks.js';
import { loadFixture } from '../../model/fixtures.js';
import { validateStack } from '../../model/validate.js';

describe('naming', () => {
  it('object names skip numbers used on the card or background, case-insensitively', () => {
    const stack = makeStack({
      backgrounds: [background('Main', [button('button 2')])],
      cards: [{ name: 'One', objects: [button('Button 1'), field('FIELD 1'), button('Button 4')] }],
    });
    expect(uniqueObjectName(stack, 0, 'button')).toBe('Button 3');
    expect(uniqueObjectName(stack, 0, 'field')).toBe('Field 2');
    expect(uniqueObjectName(stack, 0, 'image')).toBe('Image 1');
  });

  it('card names are unique across the stack', () => {
    const stack = makeStack({ cards: [{ name: 'Card 1' }, { name: 'card 2' }, { name: 'Title' }] });
    expect(uniqueCardName(stack)).toBe('Card 3');
  });

  it('uniqueId retries until the id is unused', async () => {
    const stack = await loadFixture('quiz');
    const taken = [...usedIds(stack)];
    expect(taken).toContain(stack.cards[0].objects[0].id);
    const seq = [taken[0], taken[1], 'fresh00001'];
    expect(uniqueId(stack, () => seq.shift()!)).toBe('fresh00001');
    expect(() => uniqueId(stack, () => taken[0])).toThrow('Could not generate a unique id');
  });
});

describe('objectFactory', () => {
  it('default rects are centred and clamped', () => {
    expect(defaultRect('button')).toEqual({ x: 206, y: 159, w: 100, h: 24 });
    expect(defaultRect('field')).toEqual({ x: 176, y: 139, w: 160, h: 64 });
    expect(centredRect(600, 400)).toEqual({ x: -44, y: -29, w: 600, h: 400 });
  });

  it('new objects have the REQ-4.2 defaults and keep a fixture valid', async () => {
    const stack = await loadFixture('quiz');
    const b = makeButton('newbtn0001', 'Button 1');
    const f = makeField('newfld0001', 'Field 1');
    const i = makeImage('newimg0001', 'Image 1', 'data:image/png;base64,AAAA', 300, 10);
    expect(b).toMatchObject({ style: 'roundRect', label: 'Button 1', autoHilite: true, visible: true, script: '' });
    expect(f).toMatchObject({ text: '', lockText: false, style: 'rect' });
    expect(i.rect).toEqual({ x: 106, y: 166, w: 300, h: 10 });
    stack.cards[0].objects.push(b, f, i);
    expect(() => validateStack(stack)).not.toThrow();
  });
});

describe('createNewStack', () => {
  it('builds a valid empty stack with the REQ-1.5 shape', () => {
    const now = new Date('2026-11-04T09:30:00.000Z');
    const s = createNewStack(now);
    expect(() => validateStack(s)).not.toThrow();
    expect(s.name).toBe('Untitled');
    expect(s.script).toBe('');
    expect(s.backgrounds).toHaveLength(1);
    expect(s.backgrounds[0]).toMatchObject({ name: 'Background 1', objects: [], script: '' });
    expect(s.cards).toHaveLength(1);
    expect(s.cards[0]).toMatchObject({ name: 'Card 1', objects: [], script: '', backgroundId: s.backgrounds[0].id });
    expect(s.metadata).toEqual({ created: now.toISOString(), modified: now.toISOString(), author: '' });
    expect(new Set([s.id, s.backgrounds[0].id, s.cards[0].id]).size).toBe(3);
  });

  it('never reuses an id even if the generator repeats', () => {
    const seq = ['repeat0001', 'repeat0001', 'second0001', 'third00001'];
    const s = createNewStack(new Date(), () => seq.shift()!);
    expect([s.id, s.backgrounds[0].id, s.cards[0].id]).toEqual(['repeat0001', 'second0001', 'third00001']);
  });
});
