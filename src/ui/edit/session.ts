import type { Background, CardObject, Rect, Stack } from '../../model/types.js';
import { generateId } from '../../model/id.js';
import { backgroundOf } from '../browse/objectOps.js';
import type { BrowseState } from '../browse/state.js';
import {
  acceptsProp, applyCommand, CommandError, type CommandTarget, describeCommand, type Command, type ObjectProp,
  type RectReason, type ScriptOwner,
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

/** Which layer the editor acts on (edit-background REQ-2). */
export type Layer = 'card' | 'background';

/**
 * All edit-mode operations over the shared browse working copy (no DOM). Every change is a
 * command recorded in one linear history (REQ-7).
 */
export class EditSession {
  readonly history = new History();
  selection: string | null = null;
  private layer: Layer = 'card';
  private readonly idGen: () => string;

  constructor(private readonly state: BrowseState, private readonly options: SessionOptions = {}) {
    this.idGen = options.idGen ?? generateId;
  }

  get stack(): Stack { return this.state.stack; }
  get cardIndex(): number { return this.state.cardIndex; }
  /** Monotonic counter of applied/undone/redone commands; unchanged by pure navigation. */
  get revision(): number { return this.history.revision; }
  /** True when this session edits the given runtime state (one session per loaded stack). */
  isFor(state: BrowseState): boolean { return this.state === state; }
  private get card() { return this.state.stack.cards[this.state.cardIndex]; }
  private get background(): Background { return backgroundOf(this.state.stack, this.card); }

  /** The layer the editor currently acts on (edit-background REQ-2). */
  get activeLayer(): Layer { return this.layer; }

  /** The container (and its command target) whose objects the editor currently acts on. */
  private container(): { objects: CardObject[]; target: CommandTarget } {
    return this.layer === 'background'
      ? { objects: this.background.objects, target: { kind: 'background', backgroundId: this.background.id } }
      : { objects: this.card.objects, target: { kind: 'card', cardId: this.card.id } };
  }

  /** The objects of the active layer (the current card's, or its background's). */
  activeObjects(): CardObject[] { return this.container().objects; }

  /** Switch the active layer; seals history, clears the selection (edit-background REQ-1.3). Not a command. */
  setLayer(layer: Layer): SessionEvent {
    this.history.seal();
    this.layer = layer;
    this.selection = null;
    return { render: true, select: null };
  }

  /** Toggle between the card and background layers (edit-background REQ-1.1). */
  toggleLayer(): SessionEvent {
    return this.setLayer(this.layer === 'card' ? 'background' : 'card');
  }

  /** The selected object on the active layer, if any. */
  selected(): CardObject | null {
    return this.activeObjects().find(o => o.id === this.selection) ?? null;
  }

  private object(id: string): CardObject {
    const obj = this.activeObjects().find(o => o.id === id);
    if (!obj) throw new CommandError('The object is not on this layer');
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
    this.selection = id !== null && this.activeObjects().some(o => o.id === id) ? id : null;
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
    this.run({ kind: 'setRect', target: this.container().target, objectId: id, before: structuredClone(obj.rect), after, reason });
    return { render: true, select: id };
  }

  /** Arrow-key nudge of the selection; consecutive nudges of one object form one entry. */
  nudge(dx: number, dy: number): SessionEvent | null {
    const obj = this.selected();
    if (!obj) return null;
    const after = nudgeRect(obj.rect, dx, dy);
    if (sameRect(after, obj.rect)) return null;
    this.run(
      { kind: 'setRect', target: this.container().target, objectId: obj.id, before: structuredClone(obj.rect), after, reason: 'nudge' },
      `nudge:${obj.id}`,
    );
    return { render: true, select: obj.id };
  }

  setProp(id: string, prop: ObjectProp, value: string | boolean): SessionEvent | null {
    const obj = this.object(id);
    if (!acceptsProp(obj.type, prop, value)) throw new CommandError(`A ${obj.type} has no ${prop} that can be set to ${JSON.stringify(value)}`);
    const before = (obj as unknown as Record<string, string | boolean>)[prop];
    if (before === value) return null;
    this.run({ kind: 'setProp', target: this.container().target, objectId: id, prop, before, after: value });
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
        const t = owner.target;
        const objects = t.kind === 'card'
          ? s.cards.find(c => c.id === t.cardId)?.objects
          : s.backgrounds.find(b => b.id === t.backgroundId)?.objects;
        const obj = objects?.find(o => o.id === owner.objectId);
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
    const { objects, target } = this.container();
    this.run({ kind: 'addObject', target, index: objects.length, object: structuredClone(object) });
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
    const { objects, target } = this.container();
    const index = objects.indexOf(obj);
    this.run({ kind: 'removeObject', target, index, object: structuredClone(obj) });
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

  /**
   * After undo/redo: show a card that holds the affected object, and select it only when it is on the active layer.
   * Never changes the active layer (edit-background REQ-5.3).
   */
  private focusOn(cmd: Command): SessionEvent {
    const cards = this.state.stack.cards;
    /** Show a card for a target, and select the object only if the target matches the active layer. */
    const showTarget = (target: CommandTarget, objectId: string | null): SessionEvent => {
      if (target.kind === 'card') {
        const index = cards.findIndex(c => c.id === target.cardId);
        if (index >= 0) this.state.cardIndex = index;
      } else {
        // A background: stay on the current card if it uses this background, else show the first card that does.
        if (this.card.backgroundId !== target.backgroundId) {
          const index = cards.findIndex(c => c.backgroundId === target.backgroundId);
          if (index >= 0) this.state.cardIndex = index;
        }
      }
      const onActiveLayer =
        (this.layer === 'card' && target.kind === 'card') ||
        (this.layer === 'background' && target.kind === 'background');
      const exists = onActiveLayer && objectId !== null && this.activeObjects().some(o => o.id === objectId);
      this.selection = exists ? objectId : null;
      return { cardIndex: this.state.cardIndex, select: this.selection, render: true };
    };
    const showCardId = (cardId: string, objectId: string | null): SessionEvent =>
      showTarget({ kind: 'card', cardId }, objectId);
    switch (cmd.kind) {
      case 'setRect':
      case 'setProp':
        return showTarget(cmd.target, cmd.objectId);
      case 'addObject':
      case 'removeObject':
        return showTarget(cmd.target, cmd.kind === 'addObject' ? cmd.object.id : null);
      case 'setScript':
        if (cmd.owner.kind === 'object') return showTarget(cmd.owner.target, cmd.owner.objectId);
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
