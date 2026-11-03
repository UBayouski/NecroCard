import { describe, expect, it } from 'vitest';
import { buildCardContext, buildObjectContext } from './messageContext.js';
import { background, button, makeStack } from './testStacks.js';

function sample() {
  const bgButton = button('Home', { script: 'on mouseUp\n  beep\nend mouseUp' });
  const bg = background('Main', [bgButton], 'on openCard\nend openCard');
  const own = button('Go', { script: 'on mouseUp\n  go next\nend mouseUp' });
  const stack = makeStack({
    name: 'Haunt',
    script: 'on openStack\nend openStack',
    backgrounds: [bg],
    cards: [{ name: 'One', objects: [own], script: 'on mouseUp\nend mouseUp' }, { name: 'Two' }],
  });
  return { stack, bg, bgButton, own };
}

describe('buildCardContext', () => {
  it('has card, background and stack levels with the right me, and no object level', () => {
    const { stack, bg } = sample();
    const ctx = buildCardContext(stack, 0);
    expect(ctx.object).toBeUndefined();
    expect(ctx.objectScript).toBeUndefined();
    expect(ctx.card).toEqual({ type: 'card', name: 'One' });
    expect(ctx.cardScript).toBe(stack.cards[0].script);
    expect(ctx.background).toEqual({ type: 'background', name: 'Main' });
    expect(ctx.backgroundScript).toBe(bg.script);
    expect(ctx.stack).toEqual({ type: 'stack', name: 'Haunt' });
    expect(ctx.stackScript).toBe(stack.script);
  });

  it('rejects an out-of-range card', () => {
    expect(() => buildCardContext(sample().stack, 5)).toThrow('Card index 6 is out of range');
  });
});

describe('buildObjectContext', () => {
  it('card object: object → card → background → stack', () => {
    const { stack, own } = sample();
    const ctx = buildObjectContext(stack, 0, own.id);
    expect(ctx.object).toEqual({ type: 'button', name: 'Go' });
    expect(ctx.objectScript).toBe(own.script);
    expect(ctx.card).toEqual({ type: 'card', name: 'One' });
  });

  it('background object: same path, with the current card at the card level', () => {
    const { stack, bgButton } = sample();
    const ctx = buildObjectContext(stack, 1, bgButton.id);
    expect(ctx.object).toEqual({ type: 'button', name: 'Home' });
    expect(ctx.objectScript).toBe(bgButton.script);
    expect(ctx.card).toEqual({ type: 'card', name: 'Two' });
    expect(ctx.background).toEqual({ type: 'background', name: 'Main' });
  });

  it('unknown id throws', () => {
    expect(() => buildObjectContext(sample().stack, 0, 'zzzzzzzzzz')).toThrow(/No object/);
  });
});
