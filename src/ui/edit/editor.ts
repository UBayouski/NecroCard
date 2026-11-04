import type { Stack } from '../../model/types.js';
import { validateStack } from '../../model/validate.js';
import type { BrowseRuntime, StatusLine } from '../browse/runtime.js';
import type { CardStage } from '../browse/stage.js';
import type { DomHost } from '../browse/domHost.js';
import { backgroundOf } from '../browse/objectOps.js';
import { EditSession, type SessionEvent } from './session.js';
import { EditOverlay } from './overlay.js';
import { Inspector, type InspectorView } from './inspector.js';
import type { CommandTarget } from './commands.js';
import { createEditToolbar, type EditToolbar } from './editToolbar.js';
import { showCardInfo } from './cardMenu.js';
import { importImage, pickImageFile, type ImportDeps } from './imageImport.js';
import { bindEditorInput } from './editorInput.js';
import type { Mode } from './modeToggle.js';
import type { AgentClient } from '../../summon/agentClient.js';

export interface EditControllerDeps {
  stage: CardStage;
  runtime: BrowseRuntime;
  status: StatusLine;
  /** Where the inspector panel is appended (the workspace row, after the viewport). */
  inspectorHost: HTMLElement;
  /** Where the edit toolbar row is shown. */
  toolbarHost: HTMLElement;
  /** Disabled while editing (open question 7). */
  messageBox?: HTMLInputElement;
  onModeChange?: (mode: Mode) => void;
  pickFile?: () => Promise<File | null>;
  importDeps?: ImportDeps;
  /** Validation after each command; defaults to validate-and-log in DEV builds (REQ-8). */
  validate?: (stack: Stack) => void;
  /** Explain / Fix agent for the script editors (script-editor REQ-5); defaults to the stub. */
  agent?: AgentClient;
  /** Called after each successful committed mutation, for autosave (sharing REQ-5.1). */
  onChange?: () => void;
}

const devValidate = (stack: Stack) => {
  try {
    validateStack(stack);
  } catch (e) {
    console.error('Edit left the stack invalid', e);
  }
};

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Wires the edit session to the DOM: overlay, inspector, toolbar, keys, pointer (design). */
export class EditController {
  mode: Mode = 'browse';
  session: EditSession | null = null;
  readonly overlay = new EditOverlay();
  readonly inspector: Inspector;
  readonly toolbar: EditToolbar;
  private unbind: (() => void) | null = null;
  private flushing = false;
  /** Set by bindEditorInput so toggleBackground can cancel a drag in progress (edit-background REQ-1.3). */
  cancelDrag: (() => void) | null = null;

  constructor(readonly deps: EditControllerDeps) {
    this.inspector = new Inspector({
      setRect: (id, rect) => this.op(s => s.moveTo(id, rect, 'inspector'), false),
      setProp: (id, prop, value) => this.op(s => s.setProp(id, prop, value), false),
      setScript: (owner, src) => this.op(s => s.setScript(owner, src), false),
      importImage: id => { void this.importInto(id); },
      renameCard: (cardId, name) => this.op(s => s.renameCard(cardId, name), false),
      renameStack: name => this.op(s => s.renameStack(name), false),
    }, { agent: deps.agent, status: deps.status });
    this.toolbar = createEditToolbar({
      addButton: () => this.op(s => s.addObject('button')),
      addField: () => this.op(s => s.addObject('field')),
      addImage: () => { void this.addImage(); },
      undo: () => this.op(s => s.undo()),
      redo: () => this.op(s => s.redo()),
      newCard: () => this.op(s => s.newCard()),
      deleteCard: () => this.op(s => s.deleteCard()),
      next: () => this.op(s => s.showCard(s.cardIndex + 1)),
      prev: () => this.op(s => s.showCard(s.cardIndex - 1)),
      cardInfo: () => { void this.cardInfo(); },
      editBackground: () => this.toggleBackground(),
    });
  }

  get host(): DomHost {
    const host = this.deps.runtime.currentHost;
    if (!host) throw new Error('No stack is loaded');
    return host;
  }

  /** Browse → Edit. Returns false if the runtime is busy or nothing is loaded. */
  enter(): boolean {
    const { runtime, stage } = this.deps;
    const state = runtime.currentState;
    if (this.mode === 'edit' || !state || runtime.isBusy) return this.mode === 'edit';
    if (!this.session || !this.session.isFor(state)) {
      this.session = new EditSession(state, {
        validate: this.deps.validate ?? (import.meta.env.DEV ? devValidate : undefined),
      });
    }
    this.mode = 'edit';
    runtime.setMode('edit');
    stage.setEditing(true);
    stage.surface.append(this.overlay.el);
    this.deps.inspectorHost.append(this.inspector.el);
    this.deps.toolbarHost.append(this.toolbar.el);
    this.deps.toolbarHost.hidden = false;
    if (this.deps.messageBox) this.deps.messageBox.disabled = true;
    this.unbind = bindEditorInput(this);
    this.refresh({ render: true });
    this.updateBackgroundIndicator();
    this.deps.onModeChange?.('edit');
    return true;
  }

  /** Edit → Browse: commit pending input, deselect, re-render, no messages (REQ-1.3). */
  exit(): void {
    if (this.mode !== 'edit') return;
    this.flush();
    this.session?.select(null);
    this.unbind?.();
    this.unbind = null;
    this.overlay.el.remove();
    this.inspector.dispose(); // closes any Expand dialog so its editor is not left in the page
    this.inspector.el.remove();
    this.toolbar.el.remove();
    this.deps.toolbarHost.hidden = true;
    this.mode = 'browse';
    this.deps.stage.setEditing(false);
    this.deps.stage.setEditingBackground(false);
    if (this.deps.runtime.currentHost) this.host.rerender();
    this.deps.runtime.setMode('browse');
    if (this.deps.messageBox) this.deps.messageBox.disabled = this.deps.runtime.isBusy;
    this.deps.onModeChange?.('browse');
  }

  /** A stack was loaded: back to Browse with a fresh session (history cleared, REQ-1.4). */
  reset(): void {
    this.exit();
    this.session = null;
  }

  /** Commit pending inspector input (REQ-5.4). Re-entrant safe. */
  flush(): void {
    if (this.flushing) return;
    this.flushing = true;
    try {
      this.inspector.flush();
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Run one session operation: commit pending input first (unless this *is* that commit),
   * then apply the resulting event to the DOM. Errors go to the status line.
   */
  op(fn: (s: EditSession) => SessionEvent | null, flushFirst = true): void {
    const s = this.session;
    if (!s || this.mode !== 'edit') return;
    if (flushFirst) this.flush();
    const revBefore = s.revision;
    try {
      const ev = fn(s);
      this.deps.status.clear();
      this.refresh(ev ?? { render: false });
      // Autosave only on a real content change; card navigation seals history but does not bump it.
      if (s.revision !== revBefore) this.deps.onChange?.();
    } catch (e) {
      this.deps.status.show(messageOf(e));
      this.refresh({ render: true });
    }
  }

  /** Bring card, overlay, inspector and toolbar in line with the session. */
  refresh(ev: SessionEvent): void {
    const s = this.session;
    if (!s) return;
    if (ev.cardIndex !== undefined) this.host.showCard(s.cardIndex);
    else if (ev.render) this.host.rerender();
    const selected = s.selected();
    this.deps.stage.setSelected(selected?.id ?? null);
    this.overlay.render(s.activeObjects(), selected);
    this.inspector.show(this.view());
    this.toolbar.setUndo(s.undoLabel());
    this.toolbar.setRedo(s.redoLabel());
    this.toolbar.cardMenu.setCanDelete(s.stack.cards.length > 1);
    this.toolbar.cardMenu.setEditBackground(s.activeLayer === 'background');
  }

  private view(): InspectorView {
    const s = this.session!;
    const obj = s.selected();
    if (!obj) return { kind: 'card', stack: s.stack, cardIndex: s.cardIndex };
    const card = s.stack.cards[s.cardIndex];
    const target: CommandTarget = s.activeLayer === 'background'
      ? { kind: 'background', backgroundId: card.backgroundId }
      : { kind: 'card', cardId: card.id };
    return { kind: 'object', stack: s.stack, cardIndex: s.cardIndex, obj, target };
  }

  /** Toggle the edited layer (edit-background REQ-1): cancel a drag, commit input, switch, refresh, re-indicate. */
  toggleBackground(): void {
    const s = this.session;
    if (this.mode !== 'edit' || !s) return;
    this.cancelDrag?.();
    this.flush();
    const ev = s.toggleLayer();
    this.refresh(ev);
    this.updateBackgroundIndicator();
  }

  /** Match the title-bar stripe and the menu check to the session's layer. */
  private updateBackgroundIndicator(): void {
    const on = this.mode === 'edit' && this.session?.activeLayer === 'background';
    this.deps.stage.setEditingBackground(on);
    this.toolbar.cardMenu.setEditBackground(on);
  }

  private async pick(): Promise<File | null> {
    return (this.deps.pickFile ?? pickImageFile)();
  }

  private async addImage(): Promise<void> {
    this.flush();
    const file = await this.pick();
    if (!file) return;
    try {
      const img = await importImage(file, 'fit', this.deps.importDeps);
      this.op(s => s.addImage(img.src, img.w, img.h), false);
    } catch (e) {
      this.deps.status.show(`Could not import image: ${messageOf(e)}`);
    }
  }

  private async importInto(id: string): Promise<void> {
    const obj = this.session?.selected();
    if (!obj || obj.id !== id) return;
    const file = await this.pick();
    if (!file) return;
    try {
      const img = await importImage(file, { w: obj.rect.w, h: obj.rect.h }, this.deps.importDeps);
      this.op(s => s.setProp(id, 'src', img.src), false);
    } catch (e) {
      this.deps.status.show(`Could not import image: ${messageOf(e)}`);
    }
  }

  private async cardInfo(): Promise<void> {
    const s = this.session;
    if (!s) return;
    this.flush();
    const card = s.stack.cards[s.cardIndex];
    const name = await showCardInfo({
      name: card.name,
      position: `Card ${s.cardIndex + 1} of ${s.stack.cards.length}`,
      background: backgroundOf(s.stack, card).name,
      objects: card.objects.length,
    });
    if (name !== null) this.op(ss => ss.renameCard(card.id, name), false);
  }
}
