import type { CardObject } from '../../model/types.js';
import type { HostInterface, ResolvedObjectRef } from '../../interp/evaluator.js';
import type { Note } from '../../interp/notes.js';
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
  /** Override play / stopSound (tests). */
  play?: (notes: Note[], tempo: number) => void;
  stopSound?: () => void;
  /** Called when a person types into an unlocked field in Browse (never for a script's change); for autosave. */
  onFieldEdited?: () => void;
}

let audio: AudioContext | null = null;

/**
 * Register the one-time gesture listener that creates and resumes the shared AudioContext (necrotalk-play §5.3).
 * The context is created only inside the listener, never eagerly: creating one before any user gesture makes
 * Chrome log "The AudioContext was not allowed to start". Runs at module load; before the first gesture `audio`
 * is null, so `beep`/`play` are silent — matching the browser's own autoplay gate.
 */
function bindGesture(): void {
  if (typeof globalThis.addEventListener !== 'function') return;
  const start = () => {
    try {
      const Ctor = globalThis.AudioContext;
      if (Ctor) {
        audio ??= new Ctor();
        void audio.resume().catch(() => { /* resume may reject; sound is feedback only */ });
      }
    } catch { /* audio unavailable */ }
    removeEventListener('pointerdown', start);
    removeEventListener('keydown', start);
  };
  addEventListener('pointerdown', start);
  addEventListener('keydown', start);
}
bindGesture();

/** The shared AudioContext, or null before the first gesture / when Web Audio is unavailable. */
function ensureAudio(): AudioContext | null {
  return audio;
}

const PLAY_GAIN = 0.1;        // the beep's volume
const NOTE_GAP = 0.01;        // 10 ms silence between notes (necrotalk-play REQ-4.1)
const ATTACK = 0.005, RELEASE = 0.01;

interface Voice { osc: OscillatorNode; gain: GainNode }
let voices: Voice[] = [];

/** ~100 ms square-wave beep; silent before the first gesture or if Web Audio is unavailable. */
function webAudioBeep(): void {
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    gain.gain.value = PLAY_GAIN;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  } catch {
    // Beep is feedback only; ignore audio failures.
  }
}

/** Silence every scheduled voice through its gain, then release the oscillator (necrotalk-play §5.2). */
function stopSound(): void {
  const ctx = audio;
  for (const { osc, gain } of voices) {
    try {
      if (ctx) {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime);
      }
      gain.disconnect();
    } catch { /* already torn down */ }
    try { osc.stop(); } catch { /* its scheduled stop already ran */ }
  }
  voices = [];
}

/** Schedule a melody (necrotalk-play §5.1). Replaces any melody in progress. Silent before the first gesture. */
function playNotes(notes: readonly Note[], tempo: number): void {
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    stopSound();
    let t = ctx.currentTime;
    for (const note of notes) {
      const dur = note.beats * 60 / tempo;
      if (note.frequency !== null) {
        const sound = Math.max(dur / 2, dur - NOTE_GAP);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = note.frequency;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(PLAY_GAIN, t + ATTACK);
        gain.gain.setValueAtTime(PLAY_GAIN, t + Math.max(ATTACK, sound - RELEASE));
        gain.gain.linearRampToValueAtTime(0, t + sound);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + sound);
        const voice: Voice = { osc, gain };
        voices.push(voice);
        osc.onended = () => {
          const i = voices.indexOf(voice);
          if (i >= 0) voices.splice(i, 1);
        };
      }
      t += dur;
    }
  } catch {
    // Play is feedback only; ignore audio failures.
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

  play(notes: Note[], tempo: number): void {
    (this.options.play ?? playNotes)(notes, tempo);
  }

  stopSound(): void {
    (this.options.stopSound ?? stopSound)();
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
