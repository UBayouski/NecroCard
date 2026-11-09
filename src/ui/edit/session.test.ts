import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { EditSession, type Layer } from './session.js';
import { isClamped, HANDLES, resizeRect } from './geometry.js';
import type { CommandTarget } from './commands.js';
import { createState } from '../browse/state.js';
import { background, button, field, makeStack } from '../browse/testStacks.js';
import { loadFixture, type FixtureName } from '../../model/fixtures.js';
import { serializeStack } from '../../model/serialize.js';
import { validateStack } from '../../model/validate.js';
import type { Stack } from '../../model/types.js';

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==';

/** Deterministic ids for tests: `t` + 9 digits. */
function idCounter() {
  let n = 0;
  return () => `t${String(++n).padStart(9, '0')}`;
}

function session(stack: Stack) {
  const state = createState(stack);
  const s = new EditSession(state, { idGen: idCounter(), validate: st => { validateStack(st); } });
  return { s, state };
}

function inline() {
  const bgButton = button('Shared');
  return makeStack({
    backgrounds: [background('Main', [bgButton])],
    cards: [
      { name: 'One', objects: [button('Go', { rect: { x: 10, y: 10, w: 50, h: 20 } }), field('Note')] },
      { name: 'Two' },
    ],
  });
}

describe('EditSession operations', () => {
  it('add, move, nudge, set, script, delete — valid after each', () => {
    const { s, state } = session(inline());
    const add = s.addObject('button');
    expect(add.select).toBe('t000000001');
    const obj = s.selected()!;
    expect(obj).toMatchObject({ name: 'Button 1', label: 'Button 1', type: 'button' });
    expect(s.moveTo(obj.id, { x: 20.4, y: 30, w: 100, h: 24 }, 'move')).toEqual({ render: true, select: obj.id });
    expect(obj.rect).toEqual({ x: 20, y: 30, w: 100, h: 24 });
    s.nudge(-1, 0);
    expect(obj.rect.x).toBe(19);
    s.setProp(obj.id, 'label', 'Flee');
    s.setProp(obj.id, 'visible', false);
    s.setScript({ kind: 'object', target: { kind: 'card', cardId: state.stack.cards[0].id }, objectId: obj.id }, 'on mouseUp\n  go next\nend mouseUp');
    expect(obj.script).toContain('go next');
    s.deleteSelected();
    expect(state.stack.cards[0].objects.some(o => o.id === obj.id)).toBe(false);
    expect(s.history.size).toBe(7);
  });

  it('no-op edits push nothing', () => {
    const { s } = session(inline());
    const go = s.stack.cards[0].objects[0];
    expect(s.moveTo(go.id, { ...go.rect }, 'move')).toBeNull();
    expect(s.setProp(go.id, 'label', go.type === 'button' ? go.label : '')).toBeNull();
    expect(s.setScript({ kind: 'stack' }, '')).toBeNull();
    expect(s.renameStack(s.stack.name)).toBeNull();
    expect(s.nudge(1, 0)).toBeNull(); // nothing selected
    expect(s.history.size).toBe(0);
  });

  it('rejects properties the type does not have', () => {
    const { s } = session(inline());
    const note = s.stack.cards[0].objects[1];
    expect(() => s.setProp(note.id, 'label', 'x')).toThrow(/has no label/);
  });

  it('ten Arrow nudges are one history entry; selection change starts a new one', () => {
    const { s } = session(inline());
    const go = s.stack.cards[0].objects[0];
    s.select(go.id);
    for (let i = 0; i < 10; i++) s.nudge(1, 0);
    expect(s.history.size).toBe(1);
    expect(go.rect.x).toBe(20);
    s.select(null);
    s.select(go.id);
    s.nudge(0, 10);
    expect(s.history.size).toBe(2);
    s.undo();
    s.undo();
    expect(go.rect).toEqual({ x: 10, y: 10, w: 50, h: 20 });
  });

  it('new card goes after the current one on the same background; delete card needs two cards', () => {
    const { s, state } = session(inline());
    const bgId = state.stack.cards[0].backgroundId;
    expect(s.newCard()).toEqual({ cardIndex: 1, select: null, render: true });
    expect(state.stack.cards.map(c => c.name)).toEqual(['One', 'Card 1', 'Two']);
    expect(state.stack.cards[1].backgroundId).toBe(bgId);
    s.deleteCard();
    s.deleteCard();
    expect(state.stack.cards.map(c => c.name)).toEqual(['One']);
    expect(s.deleteCard()).toBeNull();
    expect(state.cardIndex).toBe(0);
  });

  it('renames card and stack; undo/redo report the affected card and selection', () => {
    const { s, state } = session(inline());
    const go = state.stack.cards[0].objects[0];
    s.moveTo(go.id, { x: 100, y: 100, w: 50, h: 20 }, 'move');
    s.showCard(1);
    s.renameCard(state.stack.cards[1].id, 'Second');
    s.renameStack('Renamed');
    expect(s.undoLabel()).toBe('Undo Rename Stack');
    expect(s.undo()).toEqual({ render: false });
    expect(state.stack.name).toBe('Test Stack');
    expect(s.undo()).toEqual({ cardIndex: 1, select: null, render: true });
    expect(s.undo()).toEqual({ cardIndex: 0, select: go.id, render: true });
    expect(state.cardIndex).toBe(0);
    expect(s.redoLabel()).toBe('Redo Move button "Go"');
    expect(s.redo()).toEqual({ cardIndex: 0, select: go.id, render: true });
  });

  it('undo of a delete restores the object at the same index with the same id', () => {
    const { s, state } = session(inline());
    const [go, note] = state.stack.cards[0].objects;
    s.select(go.id);
    s.deleteSelected();
    expect(s.undo()).toEqual({ cardIndex: 0, select: go.id, render: true });
    expect(state.stack.cards[0].objects.map(o => o.id)).toEqual([go.id, note.id]);
  });

  it('background objects are not editable from the card layer, but are on the background layer', () => {
    const { s, state } = session(inline());
    const shared = state.stack.backgrounds[0].objects[0];
    // Card layer (default): the background object is not selectable or editable.
    s.select(shared.id);
    expect(s.selection).toBeNull();
    expect(() => s.moveTo(shared.id, { x: 0, y: 0, w: 10, h: 10 }, 'move')).toThrow('The object is not on this layer');

    // Toggle to the background layer: now it is.
    s.setLayer('background');
    expect(s.activeObjects().some(o => o.id === shared.id)).toBe(true);
    s.select(shared.id);
    expect(s.selection).toBe(shared.id);
    expect(s.moveTo(shared.id, { x: 1, y: 2, w: 10, h: 10 }, 'move')).not.toBeNull();
    expect(state.stack.backgrounds[0].objects[0].rect).toMatchObject({ x: 1, y: 2 });
  });

  it('background and stack scripts are editable', () => {
    const { s, state } = session(inline());
    s.setScript({ kind: 'background', backgroundId: state.stack.backgrounds[0].id }, '-- bg');
    s.setScript({ kind: 'stack' }, '-- stack');
    expect(state.stack.backgrounds[0].script).toBe('-- bg');
    expect(state.stack.script).toBe('-- stack');
  });

  it('a fresh session is on the card layer, and showCard keeps whichever layer is active', () => {
    const { s } = session(inline());
    expect(s.activeLayer).toBe('card');
    s.showCard(1);
    expect(s.activeLayer).toBe('card');
    s.setLayer('background');
    s.showCard(0);
    expect(s.activeLayer).toBe('background');
  });

  it('toggling the layer clears the selection, is not a command, and leaves revision unchanged', () => {
    const { s } = session(inline());
    const go = s.stack.cards[0].objects[0];
    s.moveTo(go.id, { x: 20, y: 20, w: 50, h: 20 }, 'move'); // one real command, so revision is not zero
    s.select(go.id);
    expect(s.selection).toBe(go.id);
    const revision = s.revision;
    const size = s.history.size;

    expect(s.toggleLayer()).toEqual({ render: true, select: null });
    expect(s.activeLayer).toBe('background');
    expect(s.selection).toBeNull();
    expect(s.revision).toBe(revision);
    expect(s.history.size).toBe(size);

    s.toggleLayer();
    expect(s.activeLayer).toBe('card');
    expect(s.revision).toBe(revision);
  });

  it('undoing a background command while on the card layer selects nothing and keeps the layer', () => {
    const { s } = session(inline());
    const shared = s.stack.backgrounds[0].objects[0];
    const before = structuredClone(shared.rect);
    s.setLayer('background');
    s.select(shared.id);
    s.moveTo(shared.id, { x: 40, y: 50, w: 60, h: 20 }, 'move');
    expect(s.selection).toBe(shared.id);

    s.setLayer('card'); // back on the card layer; the background command stays in history
    const event = s.undo();
    expect(event).toMatchObject({ select: null, render: true });
    expect(s.activeLayer).toBe('card'); // undo never changes the layer
    expect(s.selection).toBeNull(); // the restored object is on the inactive layer
    expect(s.stack.backgrounds[0].objects[0].rect).toEqual(before);
  });

  it('deleting a card on the background layer keeps the layer, clears the selection and resolves the new card\'s background', () => {
    const sharedA = button('SharedA');
    const sharedB = button('SharedB');
    const bgA = background('A', [sharedA]);
    const bgB = background('B', [sharedB]);
    const stack = makeStack({
      backgrounds: [bgA, bgB],
      cards: [{ name: 'One', backgroundId: bgA.id }, { name: 'Two', backgroundId: bgB.id }],
    });
    const { s, state } = session(stack);
    s.showCard(1); // card "Two", background B
    s.setLayer('background');
    s.select(sharedB.id);
    expect(s.activeObjects().map(o => o.id)).toEqual([sharedB.id]);
    expect(s.selection).toBe(sharedB.id);

    const event = s.deleteCard();
    expect(event).toEqual({ cardIndex: 0, select: null, render: true });
    expect(state.cardIndex).toBe(0);
    expect(s.activeLayer).toBe('background');
    expect(s.selection).toBeNull();
    // The current card is now "One", so the active objects come from background A.
    expect(s.activeObjects().map(o => o.id)).toEqual([sharedA.id]);
  });
});

// ---------------------------------------------------------------------------
// Property tests: random edit sequences, undo restores, redo replays
// ---------------------------------------------------------------------------

type Op =
  | { op: 'move'; pick: number; dx: number; dy: number }
  | { op: 'resize'; pick: number; handle: number; dx: number; dy: number }
  | { op: 'nudge'; pick: number; dx: number; dy: number }
  | { op: 'add'; type: 'button' | 'field' | 'image' }
  | { op: 'delete'; pick: number }
  | { op: 'prop'; pick: number; which: number; text: string }
  | { op: 'script'; pick: number; owner: number; text: string }
  | { op: 'newCard' }
  | { op: 'deleteCard' }
  | { op: 'renameCard'; text: string }
  | { op: 'renameStack'; text: string }
  | { op: 'show'; pick: number }
  | { op: 'select'; pick: number };

const text = fc.string({ unit: 'grapheme', maxLength: 12 });
const small = fc.integer({ min: -300, max: 300 });
const pick = fc.nat({ max: 50 });

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant('move' as const), pick, dx: small, dy: small }),
  fc.record({ op: fc.constant('resize' as const), pick, handle: fc.nat({ max: 7 }), dx: small, dy: small }),
  fc.record({ op: fc.constant('nudge' as const), pick, dx: fc.constantFrom(-10, -1, 0, 1, 10), dy: fc.constantFrom(-10, -1, 0, 1, 10) }),
  fc.record({ op: fc.constant('add' as const), type: fc.constantFrom('button' as const, 'field' as const, 'image' as const) }),
  fc.record({ op: fc.constant('delete' as const), pick }),
  fc.record({ op: fc.constant('prop' as const), pick, which: fc.nat({ max: 5 }), text }),
  fc.record({ op: fc.constant('script' as const), pick, owner: fc.nat({ max: 3 }), text }),
  fc.record({ op: fc.constant('newCard' as const) }),
  fc.record({ op: fc.constant('deleteCard' as const) }),
  fc.record({ op: fc.constant('renameCard' as const), text }),
  fc.record({ op: fc.constant('renameStack' as const), text }),
  fc.record({ op: fc.constant('show' as const), pick }),
  fc.record({ op: fc.constant('select' as const), pick }),
);

/** Each op is applied on a randomly chosen active layer (edit-background REQ-7.2). */
type LayeredOp = { layer: Layer; op: Op };
const layeredOpArb: fc.Arbitrary<LayeredOp> =
  fc.record({ layer: fc.constantFrom('card' as const, 'background' as const), op: opArb });

const STYLES = { button: ['rect', 'roundRect', 'transparent'], field: ['rect', 'scrolling', 'transparent'] } as const;

/** Apply one random op on the given layer through the session API. */
function runOp(s: EditSession, state: ReturnType<typeof createState>, layer: Layer, o: Op): void {
  s.setLayer(layer);
  const objects = s.activeObjects();
  const target = objects.length > 0 && 'pick' in o ? objects[o.pick % objects.length] : null;
  switch (o.op) {
    case 'move':
      if (target) s.moveTo(target.id, { ...target.rect, x: target.rect.x + o.dx, y: target.rect.y + o.dy }, 'move');
      return;
    case 'resize':
      if (target) s.moveTo(target.id, resizeRect(target.rect, HANDLES[o.handle], o.dx, o.dy), 'resize');
      return;
    case 'nudge':
      if (target) { s.select(target.id); s.nudge(o.dx, o.dy); }
      return;
    case 'add':
      if (o.type === 'image') s.addImage(TINY_PNG, 40, 30);
      else s.addObject(o.type);
      return;
    case 'delete':
      if (target) { s.select(target.id); s.deleteSelected(); }
      return;
    case 'prop': {
      if (!target) return;
      const props: [string, string | boolean][] = [['name', o.text], ['visible', o.which % 2 === 0]];
      if (target.type === 'button') props.push(['label', o.text], ['autoHilite', o.which > 2], ['style', STYLES.button[o.which % 3]]);
      if (target.type === 'field') props.push(['text', o.text], ['lockText', o.which > 2], ['style', STYLES.field[o.which % 3]]);
      if (target.type === 'image') props.push(['src', `asset-${o.text}`]);
      const [prop, value] = props[o.which % props.length];
      s.setProp(target.id, prop as never, value);
      return;
    }
    case 'script': {
      const card = state.stack.cards[state.cardIndex];
      const objTarget: CommandTarget = layer === 'background'
        ? { kind: 'background', backgroundId: card.backgroundId }
        : { kind: 'card', cardId: card.id };
      const owners = [
        { kind: 'card' as const, cardId: card.id },
        { kind: 'background' as const, backgroundId: card.backgroundId },
        { kind: 'stack' as const },
        ...(target ? [{ kind: 'object' as const, target: objTarget, objectId: target.id }] : []),
      ];
      s.setScript(owners[o.owner % owners.length], o.text);
      return;
    }
    case 'newCard': s.newCard(); return;
    case 'deleteCard': s.deleteCard(); return;
    case 'renameCard': s.renameCard(state.stack.cards[state.cardIndex].id, o.text); return;
    case 'renameStack': s.renameStack(o.text); return;
    case 'show': s.showCard(o.pick); return;
    case 'select': s.select(target?.id ?? null); return;
  }
}

function allRectsClamped(stack: Stack, touched: Set<string>): boolean {
  const all = [...stack.backgrounds.flatMap(b => b.objects), ...stack.cards.flatMap(c => c.objects)];
  return all.every(o => !touched.has(o.id) || isClamped(o.rect));
}

describe.each<FixtureName>(['quiz', 'adventure', 'flashcards'])('PBT on the %s fixture', name => {
  it('random edits on either layer keep the stack valid; undo all restores it byte for byte; redo all replays it (200 runs)', async () => {
    const fixture = await loadFixture(name);
    await fc.assert(
      fc.asyncProperty(fc.array(layeredOpArb, { minLength: 1, maxLength: 30 }), async ops => {
        const { s, state } = session(fixture);
        const original = serializeStack(state.stack);
        const touched = new Set<string>();
        for (const { layer, op: o } of ops) {
          runOp(s, state, layer, o);
          const sel = s.selection;
          if (sel && (o.op === 'move' || o.op === 'resize' || o.op === 'nudge' || o.op === 'add')) touched.add(sel);
          if (o.op === 'move' || o.op === 'resize') {
            const objs = s.activeObjects();
            if (objs.length) touched.add(objs[o.pick % objs.length].id);
          }
          expect(() => validateStack(state.stack)).not.toThrow();
          expect(allRectsClamped(state.stack, touched)).toBe(true);
        }
        const edited = serializeStack(state.stack);
        let undone = 0;
        while (s.undo()) { validateStack(state.stack); undone++; }
        expect(serializeStack(state.stack)).toBe(original);
        let redone = 0;
        while (s.redo()) { validateStack(state.stack); redone++; }
        expect(redone).toBe(undone);
        expect(serializeStack(state.stack)).toBe(edited);
      }),
      { numRuns: 200 },
    );
  });
});
