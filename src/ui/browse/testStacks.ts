// Test-only helpers for building small inline stacks. Not imported by production code.
import type {
  Background, ButtonObject, Card, CardObject, FieldObject, ImageObject, Rect, Stack,
} from '../../model/types.js';

let seq = 0;
/** Deterministic 10-char ids that match the model id pattern. */
export function testId(prefix = 'ob'): string {
  seq += 1;
  return `${prefix.slice(0, 2)}${String(seq).padStart(8, '0')}`;
}

const RECT: Rect = { x: 10, y: 10, w: 100, h: 30 };

export function button(name: string, extra: Partial<ButtonObject> = {}): ButtonObject {
  return {
    id: testId('bt'), name, type: 'button', rect: { ...RECT }, visible: true, script: '',
    style: 'rect', label: name, autoHilite: true, ...extra,
  };
}

export function field(name: string, extra: Partial<FieldObject> = {}): FieldObject {
  return {
    id: testId('fd'), name, type: 'field', rect: { ...RECT }, visible: true, script: '',
    text: '', lockText: true, style: 'rect', ...extra,
  };
}

export function image(name: string, extra: Partial<ImageObject> = {}): ImageObject {
  return {
    id: testId('im'), name, type: 'image', rect: { ...RECT }, visible: true, script: '',
    src: 'asset-1', ...extra,
  };
}

export interface CardSpec { name: string; objects?: CardObject[]; script?: string; backgroundId?: string }
export interface StackSpec {
  name?: string;
  script?: string;
  backgrounds?: Background[];
  cards: CardSpec[];
}

export function background(name: string, objects: CardObject[] = [], script = ''): Background {
  return { id: testId('bg'), name, objects, script };
}

/** Build a stack; cards without an explicit backgroundId use the first background. */
export function makeStack(spec: StackSpec): Stack {
  const backgrounds = spec.backgrounds ?? [background('Default')];
  const cards: Card[] = spec.cards.map(c => ({
    id: testId('cd'),
    name: c.name,
    backgroundId: c.backgroundId ?? backgrounds[0].id,
    objects: c.objects ?? [],
    script: c.script ?? '',
  }));
  return {
    id: testId('st'),
    name: spec.name ?? 'Test Stack',
    backgrounds,
    cards,
    script: spec.script ?? '',
    metadata: {
      created: '2026-11-03T14:00:00.000Z',
      modified: '2026-11-03T14:00:00.000Z',
      author: '',
    },
  };
}
