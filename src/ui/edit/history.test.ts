import { describe, expect, it } from 'vitest';
import { History } from './history.js';
import type { Command } from './commands.js';

const rect = (x: number) => ({ x, y: 0, w: 10, h: 10 });
const move = (id: string, from: number, to: number, reason: 'move' | 'nudge' = 'move'): Command =>
  ({ kind: 'setRect', cardId: 'c', objectId: id, before: rect(from), after: rect(to), reason });
const rename = (n: string): Command => ({ kind: 'renameStack', before: 'old', after: n });

describe('History', () => {
  it('undo returns inverses in reverse order; redo replays', () => {
    const h = new History();
    h.push(rename('a'));
    h.push(rename('b'));
    expect(h.undo()!.apply).toEqual({ kind: 'renameStack', before: 'b', after: 'old' });
    expect(h.undo()!.apply).toEqual({ kind: 'renameStack', before: 'a', after: 'old' });
    expect(h.undo()).toBeNull();
    expect(h.redo()).toEqual(rename('a'));
    expect(h.redo()).toEqual(rename('b'));
    expect(h.redo()).toBeNull();
  });

  it('a push after undo clears the redo stack', () => {
    const h = new History();
    h.push(rename('a'));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.push(rename('c'));
    expect(h.canRedo).toBe(false);
  });

  it('coalesces nudges of the same object into one entry with the first before and the last after', () => {
    const h = new History();
    h.push(move('o1', 0, 1, 'nudge'), 'nudge:o1');
    h.push(move('o1', 1, 2, 'nudge'), 'nudge:o1');
    h.push(move('o1', 2, 12, 'nudge'), 'nudge:o1');
    expect(h.size).toBe(1);
    expect(h.peekUndo()).toEqual(move('o1', 0, 12, 'nudge'));
  });

  it('seal, a different key, or undo stops coalescing', () => {
    const h = new History();
    h.push(move('o1', 0, 1, 'nudge'), 'nudge:o1');
    h.seal();
    h.push(move('o1', 1, 2, 'nudge'), 'nudge:o1');
    h.push(move('o2', 0, 1, 'nudge'), 'nudge:o2');
    expect(h.size).toBe(3);
    h.undo();
    h.redo();
    h.push(move('o2', 1, 2, 'nudge'), 'nudge:o2');
    expect(h.size).toBe(4);
  });

  it('an uncoalesced push between nudges closes the run', () => {
    const h = new History();
    h.push(move('o1', 0, 1, 'nudge'), 'nudge:o1');
    h.push(rename('x'));
    h.push(move('o1', 1, 2, 'nudge'), 'nudge:o1');
    expect(h.size).toBe(3);
  });

  it('drops the oldest entry at the cap', () => {
    const h = new History(3);
    for (const n of ['a', 'b', 'c', 'd']) h.push(rename(n));
    expect(h.size).toBe(3);
    h.undo(); h.undo(); h.undo();
    expect(h.canUndo).toBe(false);
    expect(h.peekRedo()).toEqual(rename('b'));
  });

  it('failed undo/redo can be put back without moving the position', () => {
    const h = new History();
    h.push(rename('a'));
    h.undo();
    h.restoreAfterFailedUndo();
    expect(h.peekUndo()).toEqual(rename('a'));
    expect(h.canRedo).toBe(false);
    h.undo();
    h.redo();
    h.restoreAfterFailedRedo();
    expect(h.peekRedo()).toEqual(rename('a'));
  });

  it('clear empties both stacks', () => {
    const h = new History();
    h.push(rename('a'));
    h.push(rename('b'));
    h.undo();
    h.clear();
    expect(h.canUndo || h.canRedo).toBe(false);
  });
});
