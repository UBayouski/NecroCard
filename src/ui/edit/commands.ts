import type { Card, CardObject, Rect, Stack } from '../../model/types.js';

/** Object properties the inspector can change (rect and script have their own commands). */
export type ObjectProp =
  | 'name' | 'visible' | 'style' | 'label' | 'autoHilite' | 'text' | 'lockText' | 'src';

export type ScriptOwner =
  | { kind: 'object'; cardId: string; objectId: string }
  | { kind: 'card'; cardId: string }
  | { kind: 'background'; backgroundId: string }
  | { kind: 'stack' };

export type RectReason = 'move' | 'resize' | 'nudge' | 'inspector';

/** Every edit, naming its targets by id and carrying before and after values. */
export type Command =
  | { kind: 'setRect'; cardId: string; objectId: string; before: Rect; after: Rect; reason: RectReason }
  | { kind: 'setProp'; cardId: string; objectId: string; prop: ObjectProp; before: string | boolean; after: string | boolean }
  | { kind: 'setScript'; owner: ScriptOwner; before: string; after: string }
  | { kind: 'addObject'; cardId: string; index: number; object: CardObject }
  | { kind: 'removeObject'; cardId: string; index: number; object: CardObject }
  | { kind: 'insertCard'; index: number; card: Card }
  | { kind: 'removeCard'; index: number; card: Card }
  | { kind: 'renameCard'; cardId: string; before: string; after: string }
  | { kind: 'renameStack'; before: string; after: string };

/** A command that no longer applies to the working copy (its target is missing or changed). */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

/** Which properties each object type has, and what values they accept. */
const PROPS: Record<CardObject['type'], Partial<Record<ObjectProp, 'string' | 'boolean' | readonly string[]>>> = {
  button: { name: 'string', visible: 'boolean', style: ['rect', 'roundRect', 'transparent'], label: 'string', autoHilite: 'boolean' },
  field: { name: 'string', visible: 'boolean', style: ['rect', 'scrolling', 'transparent'], text: 'string', lockText: 'boolean' },
  image: { name: 'string', visible: 'boolean', src: 'string' },
};

/** True when `prop` exists on objects of `type` and `value` is acceptable for it. */
export function acceptsProp(type: CardObject['type'], prop: ObjectProp, value: unknown): boolean {
  const spec = PROPS[type][prop];
  if (spec === undefined) return false;
  if (spec === 'string') return typeof value === 'string';
  if (spec === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string' && spec.includes(value);
}

function cardById(stack: Stack, cardId: string): Card {
  const card = stack.cards.find(c => c.id === cardId);
  if (!card) throw new CommandError('The card no longer exists');
  return card;
}

function objectById(stack: Stack, cardId: string, objectId: string): CardObject {
  const obj = cardById(stack, cardId).objects.find(o => o.id === objectId);
  if (!obj) throw new CommandError('The object no longer exists');
  return obj;
}

/** Apply a command to the stack in place. Throws CommandError (changing nothing) if it does not apply. */
export function applyCommand(stack: Stack, cmd: Command): void {
  switch (cmd.kind) {
    case 'setRect': {
      const obj = objectById(stack, cmd.cardId, cmd.objectId);
      obj.rect = structuredClone(cmd.after);
      return;
    }
    case 'setProp': {
      const obj = objectById(stack, cmd.cardId, cmd.objectId);
      if (!acceptsProp(obj.type, cmd.prop, cmd.after)) {
        throw new CommandError(`A ${obj.type} has no ${cmd.prop} that can be set to ${JSON.stringify(cmd.after)}`);
      }
      (obj as unknown as Record<string, unknown>)[cmd.prop] = cmd.after;
      return;
    }
    case 'setScript': {
      const o = cmd.owner;
      if (o.kind === 'object') objectById(stack, o.cardId, o.objectId).script = cmd.after;
      else if (o.kind === 'card') cardById(stack, o.cardId).script = cmd.after;
      else if (o.kind === 'background') {
        const bg = stack.backgrounds.find(b => b.id === o.backgroundId);
        if (!bg) throw new CommandError('The background no longer exists');
        bg.script = cmd.after;
      } else stack.script = cmd.after;
      return;
    }
    case 'addObject': {
      const card = cardById(stack, cmd.cardId);
      if (cmd.index < 0 || cmd.index > card.objects.length) throw new CommandError('The object position is out of range');
      card.objects.splice(cmd.index, 0, structuredClone(cmd.object));
      return;
    }
    case 'removeObject': {
      const card = cardById(stack, cmd.cardId);
      if (card.objects[cmd.index]?.id !== cmd.object.id) throw new CommandError('The object is not where it was');
      card.objects.splice(cmd.index, 1);
      return;
    }
    case 'insertCard': {
      if (cmd.index < 0 || cmd.index > stack.cards.length) throw new CommandError('The card position is out of range');
      if (!stack.backgrounds.some(b => b.id === cmd.card.backgroundId)) throw new CommandError('The background no longer exists');
      stack.cards.splice(cmd.index, 0, structuredClone(cmd.card));
      return;
    }
    case 'removeCard': {
      if (stack.cards[cmd.index]?.id !== cmd.card.id) throw new CommandError('The card is not where it was');
      if (stack.cards.length <= 1) throw new CommandError('A stack needs at least one card');
      stack.cards.splice(cmd.index, 1);
      return;
    }
    case 'renameCard':
      cardById(stack, cmd.cardId).name = cmd.after;
      return;
    case 'renameStack':
      stack.name = cmd.after;
      return;
  }
}

/** The command that undoes `cmd`. */
export function invertCommand(cmd: Command): Command {
  switch (cmd.kind) {
    case 'setRect':
    case 'setProp':
    case 'setScript':
    case 'renameCard':
    case 'renameStack':
      return { ...cmd, before: cmd.after, after: cmd.before } as Command;
    case 'addObject':
      return { ...cmd, kind: 'removeObject' };
    case 'removeObject':
      return { ...cmd, kind: 'addObject' };
    case 'insertCard':
      return { ...cmd, kind: 'removeCard' };
    case 'removeCard':
      return { ...cmd, kind: 'insertCard' };
  }
}

const TITLE: Record<CardObject['type'], string> = { button: 'Button', field: 'Field', image: 'Image' };

function objectLabel(stack: Stack, cardId: string, objectId: string, fallback?: CardObject): string {
  const obj = stack.cards.find(c => c.id === cardId)?.objects.find(o => o.id === objectId) ?? fallback;
  return obj ? `${TITLE[obj.type].toLowerCase()} "${obj.name}"` : 'object';
}

/** Short human description for undo/redo button titles, e.g. `Move button "Button 1"`. */
export function describeCommand(cmd: Command, stack: Stack): string {
  switch (cmd.kind) {
    case 'setRect': {
      const verb = { move: 'Move', resize: 'Resize', nudge: 'Nudge', inspector: 'Change size of' }[cmd.reason];
      return `${verb} ${objectLabel(stack, cmd.cardId, cmd.objectId)}`;
    }
    case 'setProp':
      return `Change ${cmd.prop} of ${objectLabel(stack, cmd.cardId, cmd.objectId)}`;
    case 'setScript': {
      const o = cmd.owner;
      if (o.kind === 'object') return `Edit script of ${objectLabel(stack, o.cardId, o.objectId)}`;
      return `Edit ${o.kind} script`;
    }
    case 'addObject':
      return `Add ${objectLabel(stack, cmd.cardId, cmd.object.id, cmd.object)}`;
    case 'removeObject':
      return `Delete ${objectLabel(stack, cmd.cardId, cmd.object.id, cmd.object)}`;
    case 'insertCard':
      return 'New Card';
    case 'removeCard':
      return 'Delete Card';
    case 'renameCard':
      return 'Rename Card';
    case 'renameStack':
      return 'Rename Stack';
  }
}
