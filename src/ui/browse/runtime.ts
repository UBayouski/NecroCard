import type { Stack } from '../../model/types.js';
import { dispatchMessage } from '../../interp/messageQueue.js';
import { DomHost, type DomHostOptions } from './domHost.js';
import { buildCardContext, buildObjectContext, findObjectById } from './messageContext.js';
import { runMessageBoxLine } from './messageBox.js';
import { createState, type BrowseState } from './state.js';
import type { CardStage } from './stage.js';

/** Where script errors are shown (REQ-5.5). */
export interface StatusLine {
  show(message: string): void;
  clear(): void;
}

export interface RuntimeOptions extends DomHostOptions {
  /** Called whenever the busy flag changes (chrome disables the picker and message box). */
  onBusyChange?: (busy: boolean) => void;
  /** Run a callback on the next frame (keyboard hilite flash). */
  nextFrame?: (cb: () => void) => void;
  /** Called after a stack has been loaded and its openStack/openCard have run (edit mode resets). */
  onLoad?: () => void;
}

/** What a gesture targets: an object by id, or the bare card. */
type Target = { kind: 'object'; id: string } | { kind: 'card' };

interface Gesture {
  target: Target;
  el: HTMLElement | null;
  hilite: boolean;
  release: (sameTarget: boolean) => void;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Browse-mode controller: owns the loaded stack, wires DOM events to NecroTalk messages. */
export class BrowseRuntime {
  private state: BrowseState | null = null;
  private host: DomHost | null = null;
  private gesture: Gesture | null = null;
  private mode: 'browse' | 'edit' = 'browse';

  constructor(
    private readonly stage: CardStage,
    private readonly status: StatusLine,
    private readonly options: RuntimeOptions = {},
  ) {
    const s = stage.surface;
    s.addEventListener('pointerdown', e => this.onPointerDown(e));
    s.addEventListener('pointerover', e => this.onPointerOver(e));
    s.ownerDocument.addEventListener('pointerup', e => this.onPointerUp(e));
    s.ownerDocument.addEventListener('pointercancel', () => this.endGesture(false));
    s.addEventListener('click', e => this.onClick(e));
  }

  get isBusy(): boolean { return this.state?.busy ?? false; }
  get currentState(): BrowseState | null { return this.state; }
  get currentHost(): DomHost | null { return this.host; }
  /** The live working-copy stack, or null when nothing is loaded (sharing REQ-5.1). */
  get currentStack(): Stack | null { return this.state?.stack ?? null; }
  get currentMode(): 'browse' | 'edit' { return this.mode; }

  /** Silence the play voice (necrotalk-play REQ-3.3); no-op when nothing is loaded. */
  stopSound(): void {
    this.host?.stopSound();
  }

  /**
   * Browse or edit (edit-mode REQ-1.2). In edit mode no gesture reaches a script, even if the
   * card layer were not inert. Switching modes sends no messages.
   */
  setMode(mode: 'browse' | 'edit'): void {
    this.mode = mode;
    if (mode === 'edit') this.endGesture(false);
  }

  /** Load a stack: fresh working copy, render card 1, then openStack and openCard (REQ-5.3). */
  async load(stack: Stack): Promise<boolean> {
    if (this.isBusy) return false;
    const state = createState(stack);
    const host = new DomHost(state, this.stage, m => this.sendCardMessage(m), this.options);
    this.state = state;
    this.host = host;
    this.gesture = null;
    this.mode = 'browse';
    host.mountInitialCard();
    this.status.clear();
    await this.top(this.label({ kind: 'card' }), async () => {
      await this.dispatch('openStack', { kind: 'card' });
      await this.dispatch('openCard', { kind: 'card' });
    });
    this.options.onLoad?.();
    return true;
  }

  /** Run one message-box statement (REQ-7). Not available in edit mode. */
  async runMessageBox(line: string): Promise<void> {
    const { state, host } = this;
    if (!state || !host || this.mode === 'edit') return;
    await this.top('Message box', () => runMessageBoxLine(line, host, state.globals));
  }

  // ---------------------------------------------------------------- dispatch

  private setBusy(busy: boolean): void {
    if (!this.state) return;
    this.state.busy = busy;
    this.stage.setBusy(busy);
    this.options.onBusyChange?.(busy);
  }

  /** Top-level dispatch: one at a time, errors reported, pending effect cleared after. */
  private async top(label: string, work: () => Promise<void>): Promise<boolean> {
    const state = this.state;
    if (!state || state.busy) return false;
    this.setBusy(true);
    this.status.clear();
    try {
      await work();
      return true;
    } catch (e) {
      console.error(e);
      this.status.show(`${label}: ${messageOf(e)}`);
      return false;
    } finally {
      state.pendingEffect = null;
      if (this.state === state) this.setBusy(false);
    }
  }

  private dispatch(message: string, target: Target): Promise<void> {
    const { state, host } = this;
    if (!state || !host) return Promise.resolve();
    const ctx = target.kind === 'object'
      ? buildObjectContext(state.stack, state.cardIndex, target.id)
      : buildCardContext(state.stack, state.cardIndex);
    return dispatchMessage(message, [], ctx, host, state.globals);
  }

  /** Injected into DomHost: closeCard/openCard run inside the current top-level dispatch. */
  private sendCardMessage(message: 'openCard' | 'closeCard'): Promise<void> {
    return this.dispatch(message, { kind: 'card' });
  }

  private label(target: Target): string {
    const state = this.state!;
    if (target.kind === 'card') return `Script error in card "${state.stack.cards[state.cardIndex].name}"`;
    const obj = findObjectById(state.stack, state.cardIndex, target.id);
    return obj ? `Script error in ${obj.type} "${obj.name}"` : 'Script error';
  }

  // ---------------------------------------------------------------- gestures

  /** The object element or bare card under an event, or null if not a script target. */
  private targetOf(node: EventTarget | null): { target: Target; el: HTMLElement | null } | null {
    if (!(node instanceof Element)) return null;
    const layer = this.stage.cardLayer;
    if (!layer || !layer.contains(node) || layer.inert) return null;
    const el = node.closest<HTMLElement>('[data-object-id]');
    if (!el) return { target: { kind: 'card' }, el: null };
    // Unlocked fields take the click for editing and send no messages (REQ-5.2).
    if (el.classList.contains('field') && !el.classList.contains('field--locked')) return null;
    return { target: { kind: 'object', id: el.dataset.objectId! }, el };
  }

  private autoHilite(target: Target): boolean {
    if (target.kind !== 'object' || !this.state) return false;
    const obj = findObjectById(this.state.stack, this.state.cardIndex, target.id);
    return obj?.type === 'button' && obj.autoHilite;
  }

  private setHilite(el: HTMLElement | null, on: boolean): void {
    el?.classList.toggle('button--hilite', on);
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || this.isBusy || this.gesture || this.mode === 'edit') return;
    const hit = this.targetOf(e.target);
    if (!hit || !this.state) return;
    const state = this.state;
    const startCard = state.cardIndex;
    const hilite = this.autoHilite(hit.target);
    let release!: (same: boolean) => void;
    const released = new Promise<boolean>(r => { release = r; });
    this.gesture = { target: hit.target, el: hit.el, hilite, release };
    this.setHilite(hit.el, hilite);

    void this.top(this.label(hit.target), async () => {
      try {
        await this.dispatch('mouseDown', hit.target);
        state.pendingEffect = null; // the mouseDown dispatch is finished (REQ-4.3)
        const same = await released;
        if (same && state.cardIndex === startCard && this.state === state) {
          await this.dispatch('mouseUp', hit.target);
        }
      } finally {
        this.gesture = null;
        this.setHilite(hit.el, false);
      }
    });
  }

  private sameTarget(node: EventTarget | null): boolean {
    const g = this.gesture;
    if (!g) return false;
    const hit = this.targetOf(node);
    if (!hit) return false;
    if (g.target.kind === 'card') return hit.target.kind === 'card';
    return hit.target.kind === 'object' && hit.target.id === g.target.id;
  }

  private onPointerOver(e: PointerEvent): void {
    const g = this.gesture;
    if (g?.hilite) this.setHilite(g.el, this.sameTarget(e.target));
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.endGesture(this.sameTarget(e.target));
  }

  private endGesture(same: boolean): void {
    const g = this.gesture;
    if (!g) return;
    this.setHilite(g.el, false);
    g.release(same);
  }

  /** Keyboard activation (Enter/Space) of a focused button: mouseDown then mouseUp (REQ-5.2). */
  private onClick(e: MouseEvent): void {
    if (e.detail !== 0 || this.isBusy || this.gesture || this.mode === 'edit') return;
    const hit = this.targetOf(e.target);
    if (!hit || hit.target.kind !== 'object' || !hit.el?.classList.contains('button') || !this.state) return;
    const state = this.state;
    const startCard = state.cardIndex;
    const target = hit.target;
    if (this.autoHilite(target)) {
      this.setHilite(hit.el, true);
      const next = this.options.nextFrame ?? (cb => requestAnimationFrame(() => cb()));
      next(() => this.setHilite(hit.el, false));
    }
    void this.top(this.label(target), async () => {
      await this.dispatch('mouseDown', target);
      state.pendingEffect = null;
      if (state.cardIndex === startCard) await this.dispatch('mouseUp', target);
    });
  }
}
