import type { CardObject } from '../../model/types.js';
import type { HostInterface, ResolvedObjectRef } from '../../interp/evaluator.js';
import { findField, findObject, getProp, setProp, setVisibility } from './objectOps.js';
import { findObjectById } from './messageContext.js';
import { renderCard, updateObjectEl, type RenderedCard } from './renderCard.js';
import { browserClock, runTransition, type TransitionClock, type VisualEffect } from './transitions.js';
import { showAnswer, showAsk } from './dialogs.js';
import type { CardStage } from './stage.js';
import type { BrowseState } from './state.js';

/** Sends openCard / closeCard to the current card through the message path. */
export type SendCardMessage = (message: 'openCard' | 'closeCard') => Promise<void>;

export const MAX_NAV_DEPTH = 16;

export interface DomHostOptions {
  clock?: TransitionClock;
  /** Elements outside the surface to make inert while a dialog is open (e.g. the message box). */
  dialogInert?: () => HTMLElement[];
  /** Override the beep (tests). */
  beep?: () => void;
  /** Called when a person types into an unlocked field in Browse (never for a script's change); for autosave. */
  onFieldEdited?: () => void;
}

let audio: AudioContext | null = null;

/** ~100 ms square-wave beep; silent if Web Audio is unavailable or blocked. */
function webAudioBeep(): void {
  try {
    const Ctor = globalThis.AudioContext;
    if (!Ctor) return;
    audio ??= new Ctor();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.value = 0.1;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.1);
  } catch {
    // Beep is feedback only; ignore audio failures.
  }
}

/** HostInterface over the DOM card stage (REQ-4). */
export class DomHost implements HostInterface {
  private current: RenderedCard | null = null;
  private readonly clock: TransitionClock;

  constructor(
    private readonly state: BrowseState,
    private readonly stage: CardStage,
    private readonly sendCardMessage: SendCardMessage,
    private readonly options: DomHostOptions = {},
  ) {
    this.clock = options.clock ?? browserClock;
  }

  /** Render the current card without sending messages (stack load). */
  mountInitialCard(): void {
    this.current = this.render(this.state.cardIndex);
    this.stage.setCardLayer(this.current.layer);
    this.publishCard();
  }

  /**
   * Show a card without messages or a transition (edit mode navigation). The pending visual
   * effect is left alone.
   */
  showCard(index: number): void {
    const count = this.state.stack.cards.length;
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      throw new Error(`Card index ${index + 1} is out of range`);
    }
    this.state.cardIndex = index;
    this.rerender();
  }

  /** Re-render the current card from the working copy (after edits). */
  rerender(): void {
    this.current = this.render(this.state.cardIndex);
    this.stage.setCardLayer(this.current.layer);
    this.publishCard();
  }

  /** The element rendered for an object on the current card, if any. */
  elementFor(objectId: string): HTMLElement | undefined {
    return this.current?.elements.get(objectId);
  }

  // ---------------------------------------------------------------- navigation

  async goToCard(index: number): Promise<void> {
    const count = this.state.stack.cards.length;
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      throw new Error(`Card index ${index + 1} is out of range`);
    }
    const effect = this.state.pendingEffect;
    this.state.pendingEffect = null;
    if (index === this.state.cardIndex) return;
    if (this.state.navDepth >= MAX_NAV_DEPTH) throw new Error('Too many nested go commands');

    this.state.navDepth++;
    try {
      await this.sendCardMessage('closeCard');
      const next = this.render(index);
      const old = this.current;
      if (effect && old) await runTransition(effect, old.layer, next.layer, this.clock);
      else this.stage.setCardLayer(next.layer);
      this.current = next;
      this.state.cardIndex = index;
      this.publishCard();
      await this.sendCardMessage('openCard');
    } finally {
      this.state.navDepth--;
    }
  }

  getCurrentCardIndex(): number { return this.state.cardIndex; }
  getCardCount(): number { return this.state.stack.cards.length; }
  getCardNames(): string[] { return this.state.stack.cards.map(c => c.name); }

  async setVisualEffect(effect: VisualEffect): Promise<void> {
    this.state.pendingEffect = effect;
  }

  // ---------------------------------------------------------------- dialogs

  answer(prompt: string, buttons: string[]): Promise<string> {
    return showAnswer(this.stage.surface, prompt, buttons, { inert: () => this.inertTargets() });
  }

  ask(prompt: string, defaultValue: string): Promise<string> {
    return showAsk(this.stage.surface, prompt, defaultValue, { inert: () => this.inertTargets() });
  }

  // ---------------------------------------------------------------- objects

  showObject(ref: ResolvedObjectRef): void {
    this.updateObject(setVisibility(this.state.stack, this.state.cardIndex, ref, true));
  }

  hideObject(ref: ResolvedObjectRef): void {
    this.updateObject(setVisibility(this.state.stack, this.state.cardIndex, ref, false));
  }

  getProperty(ref: ResolvedObjectRef, property: string): string {
    return getProp(findObject(this.state.stack, this.state.cardIndex, ref), property);
  }

  setProperty(ref: ResolvedObjectRef, property: string, value: string): void {
    this.updateObject(setProp(findObject(this.state.stack, this.state.cardIndex, ref), property, value));
  }

  getFieldText(ref: ResolvedObjectRef): string {
    return findField(this.state.stack, this.state.cardIndex, ref).text;
  }

  setFieldText(ref: ResolvedObjectRef, text: string): void {
    const f = findField(this.state.stack, this.state.cardIndex, ref);
    f.text = text;
    this.updateObject(f);
  }

  // ---------------------------------------------------------------- built-ins

  beep(): void {
    (this.options.beep ?? webAudioBeep)();
  }

  getDate(): string {
    return new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
  }

  getTime(): string {
    return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  random(n: number): number {
    return Math.floor(Math.random() * n) + 1;
  }

  // ---------------------------------------------------------------- internals

  private render(index: number): RenderedCard {
    return renderCard(this.state.stack, index, {
      onFieldInput: (id, text) => {
        const obj = findObjectById(this.state.stack, this.state.cardIndex, id);
        if (obj?.type === 'field') {
          obj.text = text;
          this.options.onFieldEdited?.(); // a person typed (not a script): the app may autosave
        }
      },
    });
  }

  /** Re-render one object's element after a script changed it (per-object update, no card re-render). */
  private updateObject(obj: CardObject): void {
    const el = this.current?.elements.get(obj.id);
    if (el) updateObjectEl(el, obj);
  }

  private publishCard(): void {
    const card = this.state.stack.cards[this.state.cardIndex];
    this.stage.setCard(this.state.cardIndex, card.name);
  }

  private inertTargets(): HTMLElement[] {
    const layer = this.current?.layer;
    return [...(layer ? [layer] : []), ...(this.options.dialogInert?.() ?? [])];
  }
}
