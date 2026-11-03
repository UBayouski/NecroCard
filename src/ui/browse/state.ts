import type { Stack } from '../../model/types.js';
import type { VisualEffect } from './transitions.js';

/** Runtime state of one loaded stack (design "State"). */
export interface BrowseState {
  /** Working copy; scripts and typed edits mutate this, never the fixture. */
  stack: Stack;
  /** 0-based index of the current card. */
  cardIndex: number;
  /** NecroTalk globals shared by every dispatch and the message box. */
  globals: Map<string, string>;
  /** Effect set by `visual effect`, consumed by the next card change. */
  pendingEffect: VisualEffect | null;
  /** True while a top-level dispatch (with its dialogs and transitions) is running. */
  busy: boolean;
  /** Nesting depth of goToCard calls (limit 16). */
  navDepth: number;
}

export function createState(stack: Stack): BrowseState {
  if (stack.cards.length === 0) throw new Error('The stack has no cards');
  return {
    stack: structuredClone(stack),
    cardIndex: 0,
    globals: new Map(),
    pendingEffect: null,
    busy: false,
    navDepth: 0,
  };
}
