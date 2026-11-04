import type { CardObject, Rect, Stack } from '../../model/types.js';
import { backgroundOf } from '../browse/objectOps.js';
import type { ObjectProp, CommandTarget, ScriptOwner } from './commands.js';
import {
  checkboxControl, infoLine, numberControl, selectControl, textControl, type Control,
} from './inspectorControls.js';
import { createScriptSlot, type ScriptEditorSlot } from './scriptSlot.js';
import { createStubAgentClient, type AgentClient } from '../../summon/agentClient.js';
import { scriptContext } from './scriptContext.js';

/** What every script slot needs from outside: the agent and the app status line. */
export interface InspectorScriptDeps {
  agent: AgentClient;
  status: { show(message: string): void; clear(): void };
}

/** What the inspector asks the editor to do; every call is one undoable edit. */
export interface InspectorActions {
  setRect(id: string, rect: Rect): void;
  setProp(id: string, prop: ObjectProp, value: string | boolean): void;
  setScript(owner: ScriptOwner, source: string): void;
  importImage(id: string): void;
  renameCard(cardId: string, name: string): void;
  renameStack(name: string): void;
}

export type InspectorView =
  | { kind: 'object'; stack: Stack; cardIndex: number; obj: CardObject; target?: CommandTarget }
  | { kind: 'card'; stack: Stack; cardIndex: number };

const TITLE: Record<CardObject['type'], string> = { button: 'Button', field: 'Field', image: 'Image' };
const DATA_URL_PREVIEW = 32;

/** A control plus how to read its value from the current view. */
interface Binding {
  control: { set(v: never): void; commit(): void; hasFocus(): boolean };
  read(view: InspectorView): unknown;
}

function heading(level: 2 | 3, text: string): HTMLElement {
  const h = document.createElement(`h${level}`);
  h.className = level === 2 ? 'inspector-heading' : 'inspector-subheading';
  h.textContent = text;
  return h;
}

function objectOf(view: InspectorView): CardObject {
  if (view.kind !== 'object') throw new Error('No object selected');
  // Always re-read from the stack so a stale reference never leaks after undo/redo. On the background layer the
  // selected object lives on the background, so look there too.
  const card = view.stack.cards[view.cardIndex];
  const onCard = card.objects.find(o => o.id === view.obj.id);
  if (onCard) return onCard;
  const onBg = backgroundOf(view.stack, card).objects.find(o => o.id === view.obj.id);
  return onBg ?? view.obj;
}

/** Other objects on this card or its background with the same name (case-insensitive). */
function duplicateObjectName(view: InspectorView): boolean {
  const obj = objectOf(view);
  const card = view.stack.cards[view.cardIndex];
  const all = [...card.objects, ...backgroundOf(view.stack, card).objects];
  return all.some(o => o.id !== obj.id && o.type === obj.type && o.name.toLowerCase() === obj.name.toLowerCase());
}

function duplicateCardName(view: InspectorView): boolean {
  const card = view.stack.cards[view.cardIndex];
  return view.stack.cards.some(c => c.id !== card.id && c.name.toLowerCase() === card.name.toLowerCase());
}

/** The 240 px inspector panel (REQ-5). */
export class Inspector {
  readonly el: HTMLElement;
  private bindings: Binding[] = [];
  private scripts: ScriptEditorSlot[] = [];
  private primaryScript: ScriptEditorSlot | null = null;
  private identity = '';
  private view: InspectorView | null = null;

  private readonly scriptDeps: InspectorScriptDeps;

  constructor(private readonly actions: InspectorActions, scriptDeps?: Partial<InspectorScriptDeps>) {
    this.el = document.createElement('aside');
    this.el.className = 'inspector font-ui';
    this.el.setAttribute('aria-label', 'Inspector');
    this.scriptDeps = {
      agent: scriptDeps?.agent ?? createStubAgentClient(),
      status: scriptDeps?.status ?? { show: () => {}, clear: () => {} },
    };
  }

  /** Release every script slot (closes Expand dialogs, aborts requests); the next show rebuilds. */
  dispose(): void {
    for (const s of this.scripts) s.destroy();
    this.scripts = [];
    this.bindings = [];
    this.primaryScript = null;
    this.identity = '';
    this.el.replaceChildren();
  }

  /** Show a view: rebuild when the subject changes, otherwise re-sync (never the focused control). */
  show(view: InspectorView): void {
    const card = view.stack.cards[view.cardIndex];
    const identity = view.kind === 'object' ? `object:${view.obj.id}` : `card:${card.id}`;
    this.view = view;
    if (identity !== this.identity) {
      this.identity = identity;
      this.build(view);
    }
    this.sync(view);
  }

  /** Commit any pending input (before every other operation, REQ-5.4). */
  flush(): void {
    for (const b of this.bindings) b.control.commit();
    for (const s of this.scripts) s.commit();
  }

  /** Focus the script of the selected object (double-click, REQ-5.6). */
  focusScript(): void {
    this.primaryScript?.focus();
  }

  private sync(view: InspectorView): void {
    for (const b of this.bindings) {
      if (!b.control.hasFocus()) (b.control.set as (v: unknown) => void)(b.read(view));
    }
    this.syncWarnings(view);
  }

  private warnName: ((v: InspectorView) => void) | null = null;
  private syncWarnings(view: InspectorView): void {
    this.warnName?.(view);
  }

  private bind<T>(control: Control<T> | ScriptEditorSlot, read: (view: InspectorView) => T): void {
    this.bindings.push({ control: control as Binding['control'], read });
  }

  private build(view: InspectorView): void {
    for (const s of this.scripts) s.destroy(); // close Expand dialogs and abort requests first
    this.bindings = [];
    this.scripts = [];
    this.primaryScript = null;
    this.warnName = null;
    this.el.replaceChildren();
    if (view.kind === 'object') this.buildObject(view);
    else this.buildCard(view);
  }

  private script(label: string, owner: (v: InspectorView) => ScriptOwner, read: (v: InspectorView) => string): ScriptEditorSlot {
    const slot = createScriptSlot(label, {
      agent: this.scriptDeps.agent,
      status: this.scriptDeps.status,
      context: () => scriptContext(this.view!, owner(this.view!)),
    });
    slot.onCommit(src => { if (this.view) this.actions.setScript(owner(this.view), src); });
    this.scripts.push(slot);
    this.bind(slot, read);
    return slot;
  }

  private buildObject(view: Extract<InspectorView, { kind: 'object' }>): void {
    const id = view.obj.id;
    const type = view.obj.type;
    const section = document.createElement('section');
    const title = heading(2, '');
    section.append(title);
    this.bindings.push({
      control: { set: () => { title.textContent = `${TITLE[type]} "${objectOf(this.view!).name}"`; }, commit: () => {}, hasFocus: () => false },
      read: () => null,
    });

    const name = textControl('Name', v => this.actions.setProp(id, 'name', v));
    this.bind(name, v => objectOf(v).name);
    this.warnName = v => name.warn(duplicateObjectName(v)
      ? `Another ${type} on this card has this name; scripts will find the first one.` : null);
    section.append(name.el);

    const rectRow = document.createElement('div');
    rectRow.className = 'inspector-rect';
    for (const key of ['x', 'y', 'w', 'h'] as const) {
      const c = numberControl(key.toUpperCase(), n => {
        const r = objectOf(this.view!).rect;
        this.actions.setRect(id, { ...r, [key]: n });
      });
      this.bind(c, v => objectOf(v).rect[key]);
      rectRow.append(c.el);
    }
    section.append(rectRow);

    const visible = checkboxControl('Visible', v => this.actions.setProp(id, 'visible', v));
    this.bind(visible, v => objectOf(v).visible);
    section.append(visible.el);

    if (type === 'button') {
      const style = selectControl('Style', ['rect', 'roundRect', 'transparent'], v => this.actions.setProp(id, 'style', v));
      const label = textControl('Label', v => this.actions.setProp(id, 'label', v));
      const hilite = checkboxControl('Auto hilite', v => this.actions.setProp(id, 'autoHilite', v));
      this.bind(style, v => (objectOf(v) as Extract<CardObject, { type: 'button' }>).style);
      this.bind(label, v => (objectOf(v) as Extract<CardObject, { type: 'button' }>).label);
      this.bind(hilite, v => (objectOf(v) as Extract<CardObject, { type: 'button' }>).autoHilite);
      section.append(style.el, label.el, hilite.el);
    } else if (type === 'field') {
      const text = textControl('Text', v => this.actions.setProp(id, 'text', v), { multiline: true });
      const lock = checkboxControl('Lock text', v => this.actions.setProp(id, 'lockText', v));
      const style = selectControl('Style', ['rect', 'scrolling', 'transparent'], v => this.actions.setProp(id, 'style', v));
      this.bind(text, v => (objectOf(v) as Extract<CardObject, { type: 'field' }>).text);
      this.bind(lock, v => (objectOf(v) as Extract<CardObject, { type: 'field' }>).lockText);
      this.bind(style, v => (objectOf(v) as Extract<CardObject, { type: 'field' }>).style);
      section.append(text.el, lock.el, style.el);
    } else {
      this.buildImageSource(section, id);
    }

    const defaultTarget: CommandTarget = { kind: 'card', cardId: view.stack.cards[view.cardIndex].id };
    const target = view.kind === 'object' && view.target ? view.target : defaultTarget;
    this.primaryScript = this.script('Script', () => ({ kind: 'object', target, objectId: id }), v => objectOf(v).script);
    section.append(this.primaryScript.el);
    this.el.append(section);
  }

  private buildImageSource(section: HTMLElement, id: string): void {
    const src = textControl('Source', v => this.actions.setProp(id, 'src', v));
    const input = src.el.querySelector('input')!;
    this.bindings.push({
      control: {
        set: (value: never) => {
          const s = value as string;
          const isData = s.startsWith('data:');
          input.readOnly = isData;
          src.set(isData ? `${s.slice(0, DATA_URL_PREVIEW)}… (${s.length} characters)` : s);
        },
        commit: () => src.commit(),
        hasFocus: () => src.hasFocus(),
      },
      read: v => (objectOf(v) as Extract<CardObject, { type: 'image' }>).src,
    });
    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.className = 'chrome-button';
    importButton.textContent = 'Import…';
    importButton.addEventListener('click', () => this.actions.importImage(id));
    section.append(src.el, importButton);
  }

  private buildCard(view: InspectorView): void {
    const cardOf = (v: InspectorView) => v.stack.cards[v.cardIndex];
    const card = cardOf(view);

    const cardSection = document.createElement('section');
    cardSection.append(heading(2, 'Card'));
    const name = textControl('Name', v => this.actions.renameCard(card.id, v));
    this.bind(name, v => cardOf(v).name);
    this.warnName = v => name.warn(duplicateCardName(v)
      ? `Another card has this name; go to card "${cardOf(v).name}" finds the first one.` : null);
    const position = infoLine('Position');
    this.bindings.push({
      control: { set: () => position.set(`Card ${this.view!.cardIndex + 1} of ${this.view!.stack.cards.length}`), commit: () => {}, hasFocus: () => false },
      read: () => null,
    });
    cardSection.append(name.el, position.el,
      this.script('Card script', () => ({ kind: 'card', cardId: card.id }), v => cardOf(v).script).el);

    const bgSection = document.createElement('section');
    bgSection.append(heading(3, 'Background'));
    const bgName = infoLine('Name');
    this.bindings.push({
      control: { set: () => bgName.set(backgroundOf(this.view!.stack, cardOf(this.view!)).name), commit: () => {}, hasFocus: () => false },
      read: () => null,
    });
    const bgId = card.backgroundId;
    bgSection.append(bgName.el, this.script('Background script', () => ({ kind: 'background', backgroundId: bgId }),
      v => backgroundOf(v.stack, cardOf(v)).script).el);

    const stackSection = document.createElement('section');
    stackSection.append(heading(3, 'Stack'));
    const stackName = textControl('Stack name', v => this.actions.renameStack(v));
    this.bind(stackName, v => v.stack.name);
    stackSection.append(stackName.el, this.script('Stack script', () => ({ kind: 'stack' }), v => v.stack.script).el);

    this.el.append(cardSection, bgSection, stackSection);
  }
}
