import { describe, it, expect } from 'vitest';
import { validateStack, ValidationError } from './validate.js';
import type { Stack } from './types.js';

// A minimal valid Stack for use as a test baseline.
function minimalStack(): Stack {
  return {
    id: 'Ab1234567_',
    name: 'Test Stack',
    backgrounds: [
      {
        id: 'Bg0000001_',
        name: 'Default',
        objects: [],
        script: '',
      },
    ],
    cards: [
      {
        id: 'Cd0000001_',
        name: 'Card 1',
        backgroundId: 'Bg0000001_',
        objects: [],
        script: '',
      },
    ],
    script: '',
    metadata: {
      created: '2026-11-03T14:00:00.000Z',
      modified: '2026-11-03T14:00:00.000Z',
      author: 'Test',
    },
  };
}

describe('validateStack', () => {
  it('accepts a valid minimal Stack', () => {
    expect(() => validateStack(minimalStack())).not.toThrow();
    const result = validateStack(minimalStack());
    expect(result.name).toBe('Test Stack');
  });

  it('accepts a Stack with all three object types', () => {
    const stack = minimalStack();
    stack.cards[0].objects = [
      {
        id: 'Ob0000001_',
        name: 'A Button',
        type: 'button',
        rect: { x: 0, y: 0, w: 100, h: 30 },
        visible: true,
        script: '',
        style: 'rect',
        label: 'Click me',
        autoHilite: false,
      },
      {
        id: 'Ob0000002_',
        name: 'A Field',
        type: 'field',
        rect: { x: 0, y: 40, w: 200, h: 50 },
        visible: true,
        script: '',
        text: 'Hello',
        lockText: false,
        style: 'rect',
      },
      {
        id: 'Ob0000003_',
        name: 'An Image',
        type: 'image',
        rect: { x: 0, y: 100, w: 64, h: 64 },
        visible: true,
        script: '',
        src: 'data:image/png;base64,abc',
      },
    ];
    expect(() => validateStack(stack)).not.toThrow();
  });

  it('throws ValidationError when a required field is missing', () => {
    const bad = minimalStack() as unknown as Record<string, unknown>;
    delete bad.name;
    expect(() => validateStack(bad)).toThrowError(ValidationError);
  });

  it('throws ValidationError for a wrong enum value on ButtonObject.style', () => {
    const stack = minimalStack();
    stack.cards[0].objects = [
      {
        id: 'Ob0000001_',
        name: 'Bad Button',
        type: 'button',
        rect: { x: 0, y: 0, w: 100, h: 30 },
        visible: true,
        script: '',
        style: 'oval' as 'rect', // invalid
        label: 'Click',
        autoHilite: false,
      },
    ];
    expect(() => validateStack(stack)).toThrowError(ValidationError);
  });

  it('throws ValidationError when an id does not match the pattern', () => {
    const stack = minimalStack();
    stack.id = 'not-valid!!'; // too long and contains invalid chars
    expect(() => validateStack(stack)).toThrowError(ValidationError);
  });

  it('throws ValidationError when an id is too short', () => {
    const stack = minimalStack();
    stack.id = 'abc'; // only 3 chars, minimum is 8
    expect(() => validateStack(stack)).toThrowError(ValidationError);
  });

  it('throws ValidationError for an unknown extra field', () => {
    const bad = { ...minimalStack(), extraField: 'surprise' };
    expect(() => validateStack(bad)).toThrowError(ValidationError);
  });

  it('throws ValidationError when metadata.created is not an ISO date-time', () => {
    const stack = minimalStack();
    stack.metadata.created = '2026/11/03'; // wrong format
    expect(() => validateStack(stack)).toThrowError(ValidationError);
  });

  it('ValidationError carries an errors array', () => {
    const bad = minimalStack() as unknown as Record<string, unknown>;
    delete bad.name;
    try {
      validateStack(bad);
      throw new Error('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).errors.length).toBeGreaterThan(0);
    }
  });
});
