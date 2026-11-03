import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  findField, findObject, getProp, parseBoolean, setProp, setVisibility,
} from './objectOps.js';
import { background, button, field, image, makeStack } from './testStacks.js';

function sample() {
  const bgField = field('Title', { text: 'shared' });
  const bgButton = button('Home');
  const bg = background('Main', [bgField, bgButton], 'on mouseUp\nend mouseUp');
  const cardField = field('Title', { text: 'own' });
  const dup1 = button('Dup', { label: 'first' });
  const dup2 = button('Dup', { label: 'second' });
  const pic = image('Bat');
  const stack = makeStack({
    name: 'S',
    backgrounds: [bg],
    cards: [
      { name: 'One', objects: [cardField, dup1, dup2, pic] },
      { name: 'Two', objects: [] },
    ],
  });
  return { stack, bgField, bgButton, cardField, dup1, dup2, pic };
}

describe('findObject', () => {
  it('prefers card objects over background objects with the same name', () => {
    const { stack, cardField } = sample();
    const hit = findObject(stack, 0, { type: 'field', name: 'Title' });
    expect(hit).toEqual({ kind: 'object', obj: cardField, layer: 'card' });
  });

  it('falls back to background objects', () => {
    const { stack, bgField, bgButton } = sample();
    expect(findObject(stack, 1, { type: 'field', name: 'title' })).toEqual({ kind: 'object', obj: bgField, layer: 'background' });
    expect(findObject(stack, 0, { type: 'button', name: 'HOME' })).toEqual({ kind: 'object', obj: bgButton, layer: 'background' });
  });

  it('first match wins for duplicate names', () => {
    const { stack, dup1 } = sample();
    const hit = findObject(stack, 0, { type: 'button', name: 'dup' });
    expect(hit.kind === 'object' && hit.obj).toBe(dup1);
  });

  it('type must match exactly', () => {
    const { stack } = sample();
    expect(() => findObject(stack, 0, { type: 'button', name: 'Bat' })).toThrow('No button named "Bat"');
    expect(() => findObject(stack, 0, { type: 'image', name: 'Nope' })).toThrow('No image named "Nope"');
  });

  it('resolves card, background and stack refs', () => {
    const { stack } = sample();
    const card = findObject(stack, 0, { type: 'card', name: 'two' });
    expect(card.kind === 'card' && card.index).toBe(1);
    expect(() => findObject(stack, 0, { type: 'card', name: 'Three' })).toThrow('No card named "Three"');
    expect(findObject(stack, 0, { type: 'background', name: 'Main' }).kind).toBe('background');
    expect(findObject(stack, 0, { type: 'stack', name: 'S' }).kind).toBe('stack');
  });
});

describe('getProp / setProp', () => {
  it('reads and writes label, text and visible case-insensitively', () => {
    const { stack, cardField, dup1 } = sample();
    const b = findObject(stack, 0, { type: 'button', name: 'Dup' });
    const f = findObject(stack, 0, { type: 'field', name: 'Title' });
    expect(getProp(b, 'LABEL')).toBe('first');
    setProp(b, 'Label', 'changed');
    expect(dup1.label).toBe('changed');
    expect(getProp(f, 'text')).toBe('own');
    setProp(f, 'TEXT', 'new');
    expect(cardField.text).toBe('new');
    expect(getProp(f, 'visible')).toBe('true');
    setProp(f, 'visible', 'FALSE');
    expect(cardField.visible).toBe(false);
    expect(getProp(f, 'Visible')).toBe('false');
  });

  it('rejects properties the object type does not have', () => {
    const { stack } = sample();
    const b = findObject(stack, 0, { type: 'button', name: 'Dup' });
    const f = findObject(stack, 0, { type: 'field', name: 'Title' });
    const i = findObject(stack, 0, { type: 'image', name: 'Bat' });
    expect(() => getProp(b, 'text')).toThrow('Unknown property "text"');
    expect(() => getProp(f, 'label')).toThrow('Unknown property "label"');
    expect(() => getProp(i, 'label')).toThrow('Unknown property "label"');
    expect(() => setProp(b, 'color', 'red')).toThrow('Unknown property "color"');
    expect(getProp(i, 'visible')).toBe('true');
  });

  it('cards, backgrounds and the stack have no properties in this version', () => {
    const { stack } = sample();
    for (const ref of [
      { type: 'card', name: 'One' }, { type: 'background', name: 'Main' }, { type: 'stack', name: 'S' },
    ] as const) {
      const hit = findObject(stack, 0, ref);
      expect(() => getProp(hit, 'visible')).toThrow('Unknown property "visible"');
      expect(() => setProp(hit, 'name', 'x')).toThrow('Unknown property "name"');
    }
  });

  it('visible accepts only true/false', () => {
    const { stack } = sample();
    const b = findObject(stack, 0, { type: 'button', name: 'Dup' });
    expect(() => setProp(b, 'visible', 'maybe')).toThrow('Expected true or false but got "maybe"');
    expect(parseBoolean('True')).toBe(true);
  });

  it('PBT: set then get returns the same value', () => {
    const value = fc.string({ unit: 'grapheme' }).filter(s => !/["\r\n]/.test(s));
    fc.assert(
      fc.property(value, value, fc.boolean(), (label, text, visible) => {
        const { stack } = sample();
        const b = findObject(stack, 0, { type: 'button', name: 'Dup' });
        setProp(b, 'label', label);
        expect(getProp(b, 'label')).toBe(label);
        const f = findObject(stack, 0, { type: 'field', name: 'Title' });
        setProp(f, 'text', text);
        expect(getProp(f, 'text')).toBe(text);
        expect(findField(stack, 0, { type: 'field', name: 'Title' }).text).toBe(text);
        setProp(b, 'visible', String(visible));
        expect(getProp(b, 'visible')).toBe(String(visible));
      }),
      { numRuns: 200 },
    );
  });
});

describe('findField / setVisibility', () => {
  it('findField rejects non-field refs', () => {
    const { stack } = sample();
    expect(() => findField(stack, 0, { type: 'button', name: 'Dup' })).toThrow('No field named "Dup"');
    expect(() => findField(stack, 0, { type: 'field', name: 'Nope' })).toThrow('No field named "Nope"');
  });

  it('show/hide objects; cards and stacks cannot be shown or hidden', () => {
    const { stack, pic } = sample();
    setVisibility(stack, 0, { type: 'image', name: 'Bat' }, false);
    expect(pic.visible).toBe(false);
    expect(() => setVisibility(stack, 0, { type: 'card', name: 'One' }, false)).toThrow('Cannot hide a card');
    expect(() => setVisibility(stack, 0, { type: 'stack', name: 'S' }, true)).toThrow('Cannot show a stack');
    expect(() => setVisibility(stack, 0, { type: 'background', name: 'Main' }, true)).toThrow('Cannot show a background');
  });
});
