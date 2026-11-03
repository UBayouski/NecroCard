import type { Stack } from '../../model/types.js';
import type { ScriptContext } from '../../summon/agentClient.js';
import { backgroundOf } from '../browse/objectOps.js';
import type { ScriptOwner } from './commands.js';

/** Describe a script owner to the agent (script-editor REQ-5.1). */
export function scriptContext(view: { stack: Stack; cardIndex: number }, owner: ScriptOwner): ScriptContext {
  const stack = view.stack;
  const card = stack.cards[view.cardIndex];
  const bg = backgroundOf(stack, card);
  const objectNames = [...card.objects, ...bg.objects].map(o => ({ type: o.type, name: o.name }));
  switch (owner.kind) {
    case 'object': {
      const obj = stack.cards.find(c => c.id === owner.cardId)?.objects.find(o => o.id === owner.objectId);
      return {
        owner: { type: obj?.type ?? 'button', name: obj?.name ?? '' },
        stackName: stack.name, cardName: card.name, backgroundName: bg.name, objectNames,
      };
    }
    case 'card':
      return { owner: { type: 'card', name: card.name }, stackName: stack.name, cardName: card.name, backgroundName: bg.name, objectNames };
    case 'background':
      return { owner: { type: 'background', name: bg.name }, stackName: stack.name, cardName: null, backgroundName: bg.name, objectNames };
    case 'stack':
      return { owner: { type: 'stack', name: stack.name }, stackName: stack.name, cardName: null, backgroundName: null, objectNames };
  }
}
