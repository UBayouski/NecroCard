import type { CardObject, Rect, Stack } from '../../model/types.js';
import { generateId } from '../../model/id.js';
import type { BrowseState } from '../browse/state.js';
import {
  acceptsProp, applyCommand, CommandError, describeCommand, type Command, type ObjectProp, type RectReason,
  type ScriptOwner,
} from './commands.js';
import { History } from './history.js';
import { clampRect, nudgeRect } from './geometry.js';
import { uniqueCardName, uniqueId, uniqueObjectName } from './naming.js';
import { makeButton, makeField, makeImage } from './objectFactory.js';

/** What the editor must do after an operation. */
export interface SessionEvent {
  /** Card to show, when it changed. */
  cardIndex?: number;
  /** Object to select afterwards; null clears; undefined keeps the selection. */
  select?: string | null;
  /** Whether the current card must be re-rendered. */
  render: boolean;
}

export interface SessionOptions {
  idGen?: () => string;
  /** Called after every applied command (tests: validateStack; DEV builds: validate and log). */
  validate?: (stack: Stack) => void;
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * All edit-mode operations over the shared browse working copy (no DOM). Every change is a
 * command recorded in one linear history (REQ-7).
 */
export class EditSession {
  readonly history = new History();
  selection: string | null = null;
  private readonly idGen: () => string;

  constructor(private readonly state: BrowseState, private readonly options: SessionOptions = {}) {
    this.idGen = options.idGen ?? generateId;
  }

  get stack(): Stack { return this.state.stack; }
  get cardIndex(): number { return this.state.cardIndex; }
  /** True when this session edits the given runtime state (one session per loaded stack). */
  isFor(state: BrowseState): boolean { return this.state === state; }
  private get card() { return this.state.stack.cards[this.state.cardIndex]; }

  /** The selected object on the current card, if any. */
  selected(): CardObject | null {
    return this.card.objects.find(o => o.id === this.selection) ?? null;
  }

  private object(id: string): CardObject {
    const obj = this.card.objects.find(o => o.id === id);
    if (!obj) throw new CommandError('The object is not on this card');
    return obj;
  }

  private run(cmd: Command, coalesceKey?: string): void {
    applyCommand(this.state.stack, cmd);
    this.history.push(cmd, coalesceKey);
    this.options.validate?.(this.state.stack);
  }

  // ---------------------------------------------------------------- selection and navigation

  select(id: string | null): void {
    this.history.seal();
    this.selection = id !== null && this.card.objects.some(o => o.id === id) ? id : null;
  }

  showCard(index: number): SessionEvent {
    const count = this.state.stack.cards.length;
    const i = ((index % count) + count) % count;
    this.history.seal();
    this.selection = null;
    this.state.cardIndex = i;
    return { cardIndex: i, select: null, render: true };
  }

  // ---------------------------------------------------------------- object edits

  moveTo(id: string, rect: Rect, reason: Exclude<RectReason, 'nudge'>): SessionEvent | null {
    const obj = this.object(id);
    const after = clampRect(rect);
    if (sameRect(after, obj.rect)) return null;
    this.run({ kind: 'setRect', cardId: this.card.id, objectId: id, before: structuredClone(obj.rect), after, reason });
    return { render: true, select: id };
  }

  /** Arrow-key nudge of the selection; consecutive nudges of one object form one entry. */
  nudge(dx: number, dy: number): SessionEvent | null {
    const obj = this.selected();
    if (!obj) return null;
    const after = nudgeRect(obj.rect, dx, dy);
    if (sameRect(after, obj.rect)) return null;
    this.run(
      { kind: 'setRect', cardId: this.card.id, objectId: obj.id, before: structuredClone(obj.rect), after, reason: 'nudge' },
      `nudge:${obj.id}`,
    );
    return { render: true, select: obj.id };
  }

  setProp(id: string, prop: ObjectProp, value: string | boolean): SessionEvent | null {
    const obj = this.object(id);
    if (!acceptsProp(obj.type, prop, value)) throw new CommandError(`A ${obj.type} has no ${prop} that can be set to ${JSON.stringify(value)}`);
    const before = (obj as unknown as Record<string, string | boolean>)[prop];
    if (before === value) return null;
    this.run({ kind: 'setProp', cardId: this.card.id, objectId: id, prop, before, after: value });
    return { render: true, select: id };
  }

  setScript(owner: ScriptOwner, script: string): SessionEvent | null {
    const before = this.scriptOf(owner);
    if (before === script) return null;
    this.run({ kind: 'setScript', owner, before, after: script });
    return { render: false };
  }

  /** Current source of a script owner. */
  scriptOf(owner: ScriptOwner): string {
    const s = this.state.stack;
    switch (owner.kind) {
      case 'object': {
        const obj = s.cards.find(c => c.id === owner.cardId)?.objects.find(o => o.id === owner.objectId);
        if (!obj) throw new CommandError('The object no longer exists');
        return obj.script;
      }
      case 'card': {
        const card = s.cards.find(c => c.id === owner.cardId);
        if (!card) throw new CommandError('The card no longer exists');
        return card.script;
      }
      case 'background': {
        const bg = s.backgrounds.find(b => b.id === owner.backgroundId);
        if (!bg) throw new CommandError('The background no longer exists');
        return bg.script;
      }
      case 'stack':
        return s.script;
    }
  }

  private add(object: CardObject): SessionEvent {
    this.run({ kind: 'addObject', cardId: this.card.id, index: this.card.objects.length, object: structuredClone(object) });
    this.selection = object.id;
    return { render: true, select: object.id };
  }

  addObject(type: 'button' | 'field'): SessionEvent {
    const id = uniqueId(this.state.stack, this.idGen);
    const name = uniqueObjectName(this.state.stack, this.state.cardIndex, type);
    return this.add(type === 'button' ? makeButton(id, name) : makeField(id, name));
  }

  addImage(src: string, w: number, h: number): SessionEvent {
    const id = uniqueId(this.state.stack, this.idGen);
    const name = uniqueObjectName(this.state.stack, this.state.cardIndex, 'image');
    return this.add(makeImage(id, name, src, w, h));
  }

  deleteSelected(): SessionEvent | null {
    const obj = this.selected();
    if (!obj) return null;
    const index = this.card.objects.indexOf(obj);
    this.run({ kind: 'removeObject', cardId: this.card.id, index, object: structuredClone(obj) });
    this.selection = null;
    return { render: true, select: null };
  }

  // ---------------------------------------------------------------- card and stack edits

  newCard(): SessionEvent {
    const index = this.state.cardIndex + 1;
    const card = {
      id: uniqueId(this.state.stack, this.idGen),
      name: uniqueCardName(this.state.stack),
      backgroundId: this.card.backgroundId,
      objects: [],
      script: '',
    };
    this.run({ kind: 'insertCard', index, card });
    this.selection = null;
    this.state.cardIndex = index;
    return { cardIndex: index, select: null, render: true };
  }

  deleteCard(): SessionEvent | null {
    const cards = this.state.stack.cards;
    if (cards.length <= 1) return null;
    const index = this.state.cardIndex;
    this.run({ kind: 'removeCard', index, card: structuredClone(cards[index]) });
    this.selection = null;
    this.state.cardIndex = Math.min(index, cards.length - 1);
    return { cardIndex: this.state.cardIndex, select: null, render: true };
  }

  renameCard(cardId: string, name: string): SessionEvent | null {
    const card = this.state.stack.cards.find(c => c.id === cardId);
    if (!card) throw new CommandError('The card no longer exists');
    if (card.name === name) return null;
    this.run({ kind: 'renameCard', cardId, before: card.name, after: name });
    return { render: true };
  }

  renameStack(name: string): SessionEvent | null {
    if (this.state.stack.name === name) return null;
    this.run({ kind: 'renameStack', before: this.state.stack.name, after: name });
    return { render: false };
  }

  // ---------------------------------------------------------------- undo / redo

  undo(): SessionEvent | null {
    const step = this.history.undo();
    if (!step) return null;
    try {
      applyCommand(this.state.stack, step.apply);
    } catch (e) {
      this.history.restoreAfterFailedUndo();
      throw e;
    }
    this.options.validate?.(this.state.stack);
    return this.focusOn(step.apply);
  }

  redo(): SessionEvent | null {
    const cmd = this.history.redo();
    if (!cmd) return null;
    try {
      applyCommand(this.state.stack, cmd);
    } catch (e) {
      this.history.restoreAfterFailedRedo();
      throw e;
    }
    this.options.validate?.(this.state.stack);
    return this.focusOn(cmd);
  }

  undoLabel(): string | null {
    const c = this.history.peekUndo();
    return c ? `Undo ${describeCommand(c, this.state.stack)}` : null;
  }

  redoLabel(): string | null {
    const c = this.history.peekRedo();
    return c ? `Redo ${describeCommand(c, this.state.stack)}` : null;
  }

  /** After undo/redo: show the card the command touched and select the object it changed. */
  private focusOn(cmd: Command): SessionEvent {
    const cards = this.state.stack.cards;
    const showCardId = (cardId: string, objectId: string | null): SessionEvent => {
      const index = cards.findIndex(c => c.id === cardId);
      if (index >= 0) this.state.cardIndex = index;
      const exists = objectId !== null && cards[this.state.cardIndex].objects.some(o => o.id === objectId);
      this.selection = exists ? objectId : null;
      return { cardIndex: this.state.cardIndex, select: this.selection, render: true };
    };
    switch (cmd.kind) {
      case 'setRect':
      case 'setProp':
        return showCardId(cmd.cardId, cmd.objectId);
      case 'addObject':
      case 'removeObject':
        return showCardId(cmd.cardId, cmd.kind === 'addObject' ? cmd.object.id : null);
      case 'setScript':
        if (cmd.owner.kind === 'object') return showCardId(cmd.owner.cardId, cmd.owner.objectId);
        if (cmd.owner.kind === 'card') return showCardId(cmd.owner.cardId, null);
        return { render: false };
      case 'renameCard':
        return showCardId(cmd.cardId, null);
      case 'insertCard':
        return showCardId(cmd.card.id, null);
      case 'removeCard':
        this.selection = null;
        this.state.cardIndex = Math.min(cmd.index, cards.length - 1);
        return { cardIndex: this.state.cardIndex, select: null, render: true };
      case 'renameStack':
        return { render: false };
    }
  }
}
