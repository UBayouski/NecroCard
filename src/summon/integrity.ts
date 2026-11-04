// Checks a schema-valid stack for what the JSON schema cannot express, and lists its scripts with
// user-facing owner descriptions (summon REQ-3.1 steps 4–5, REQ-3.2).
import type { CardObject, Stack } from '../model/types.js';

export interface ScriptSite {
  /** e.g. `Script of button "Next" on card "Q1"` */
  where: string;
  script: string;
}

const objectOn = (o: CardObject, place: string) => `${o.type} "${o.name}" on ${place}`;

/** Every non-empty script: stack, then each background and its objects, then each card and its objects. */
export function scriptsOf(stack: Stack): ScriptSite[] {
  const sites: ScriptSite[] = [];
  const add = (owner: string, script: string) => {
    if (script.trim() !== '') sites.push({ where: `Script of ${owner}`, script });
  };
  add(`stack "${stack.name}"`, stack.script);
  for (const bg of stack.backgrounds) {
    add(`background "${bg.name}"`, bg.script);
    for (const o of bg.objects) add(objectOn(o, `background "${bg.name}"`), o.script);
  }
  for (const card of stack.cards) {
    add(`card "${card.name}"`, card.script);
    for (const o of card.objects) add(objectOn(o, `card "${card.name}"`), o.script);
  }
  return sites;
}

/** Problems as plain-English lines; [] when the stack is fine. */
export function checkIntegrity(stack: Stack): string[] {
  const problems: string[] = [];
  if (stack.backgrounds.length === 0) problems.push('The stack has no backgrounds');
  if (stack.cards.length === 0) problems.push('The stack has no cards');

  const owners = new Map<string, string[]>();
  const note = (id: string, owner: string) => owners.set(id, [...(owners.get(id) ?? []), owner]);
  note(stack.id, `stack "${stack.name}"`);
  for (const bg of stack.backgrounds) {
    note(bg.id, `background "${bg.name}"`);
    for (const o of bg.objects) note(o.id, objectOn(o, `background "${bg.name}"`));
  }
  for (const card of stack.cards) {
    note(card.id, `card "${card.name}"`);
    for (const o of card.objects) note(o.id, objectOn(o, `card "${card.name}"`));
  }
  for (const [id, list] of owners) {
    if (list.length > 1) problems.push(`Id "${id}" is used more than once: ${list.join(', ')}`);
  }

  const backgroundIds = new Set(stack.backgrounds.map(b => b.id));
  for (const card of stack.cards) {
    if (!backgroundIds.has(card.backgroundId)) {
      problems.push(`Card "${card.name}": backgroundId "${card.backgroundId}" does not match any background`);
    }
  }

  const places = [
    ...stack.backgrounds.map(b => ({ place: `background "${b.name}"`, objects: b.objects })),
    ...stack.cards.map(c => ({ place: `card "${c.name}"`, objects: c.objects })),
  ];
  for (const { place, objects } of places) {
    for (const o of objects) {
      if (o.type === 'image') problems.push(`Image "${o.name}" on ${place}: image objects are not allowed in Summon`);
    }
  }
  return problems;
}
