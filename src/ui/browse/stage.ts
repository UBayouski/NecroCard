import { CARD_HEIGHT, CARD_WIDTH, computeScale } from './scale.js';

/**
 * The card viewport: a flexible chrome area containing a HyperCard-style window (title bar + frame) sized to the
 * scaled card, which holds the fixed 512 × 342 `.card-surface` scaled with `transform: scale()`.
 * Dialogs and transition layers are children of the surface so they scale with it.
 */
export class CardStage {
  readonly viewport: HTMLElement;
  readonly surface: HTMLElement;
  private readonly window: HTMLElement;
  private readonly titleBar: HTMLElement;
  private readonly titleLabel: HTMLElement;
  private readonly frame: HTMLElement;
  private observer: ResizeObserver | null = null;
  private scale = 1;

  constructor(doc: Document = document) {
    this.viewport = doc.createElement('main');
    this.viewport.className = 'card-viewport';
    this.window = doc.createElement('div');
    this.window.className = 'card-window';
    // Decorative: the stack name is already in the picker, so a screen reader need not hear it twice.
    this.titleBar = doc.createElement('div');
    this.titleBar.className = 'card-window-title';
    this.titleBar.setAttribute('aria-hidden', 'true');
    this.titleLabel = doc.createElement('span');
    this.titleLabel.className = 'card-window-title-label';
    this.titleBar.append(this.titleLabel);
    this.frame = doc.createElement('div');
    this.frame.className = 'card-frame';
    this.surface = doc.createElement('div');
    this.surface.className = 'card-surface';
    this.surface.setAttribute('role', 'application');
    this.surface.setAttribute('aria-label', 'HyperCard stack');
    this.surface.dataset.cardIndex = '0';
    this.surface.dataset.cardName = '';
    this.surface.dataset.busy = 'false';
    this.surface.dataset.mode = 'browse';
    this.frame.append(this.surface);
    this.window.append(this.titleBar, this.frame);
    this.viewport.append(this.window);
  }

  /** The stack name shown in the window's title bar. */
  setTitle(name: string): void {
    this.titleLabel.textContent = name;
  }

  get title(): string {
    return this.titleLabel.textContent ?? '';
  }

  /** Start fitting the card to the viewport; call after the viewport is in the document. */
  observe(): void {
    if (this.observer || typeof ResizeObserver === 'undefined') {
      this.fit();
      return;
    }
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(this.viewport);
    this.fit();
  }

  disconnect(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  /**
   * Recompute the scale from the viewport's content box minus everything the window adds around the card:
   * its borders, the title bar, and the frame border (REQ-1.2).
   */
  fit(): void {
    const view = this.viewport.ownerDocument.defaultView;
    const px = (v: string | undefined) => parseFloat(v ?? '') || 0;
    const vs = view?.getComputedStyle(this.viewport);
    const ws = view?.getComputedStyle(this.window);
    const fs = view?.getComputedStyle(this.frame);
    const w = this.viewport.clientWidth - px(vs?.paddingLeft) - px(vs?.paddingRight)
      - px(ws?.borderLeftWidth) - px(ws?.borderRightWidth)
      - px(fs?.borderLeftWidth) - px(fs?.borderRightWidth);
    const h = this.viewport.clientHeight - px(vs?.paddingTop) - px(vs?.paddingBottom)
      - px(ws?.borderTopWidth) - px(ws?.borderBottomWidth)
      - this.titleBar.offsetHeight
      - px(fs?.borderTopWidth) - px(fs?.borderBottomWidth);
    this.applyScale(w > 0 && h > 0 ? computeScale(w, h) : 1);
  }

  applyScale(s: number): void {
    this.scale = s;
    this.surface.style.transform = `scale(${s})`;
    this.frame.style.width = `${CARD_WIDTH * s}px`;
    this.frame.style.height = `${CARD_HEIGHT * s}px`;
  }

  get currentScale(): number {
    return this.scale;
  }

  /** The card layer currently shown (the first `.card-layer` child of the surface). */
  get cardLayer(): HTMLElement | null {
    return this.surface.querySelector<HTMLElement>(':scope > .card-layer');
  }

  /** Replace the shown card layer without a transition. */
  setCardLayer(layer: HTMLElement): void {
    if (this.editing) layer.inert = true;
    const old = this.cardLayer;
    if (old) old.replaceWith(layer);
    else this.surface.prepend(layer);
  }

  private editing = false;

  /**
   * Edit mode (edit-mode REQ-1.2): `data-mode`, card layers inert (now and every layer set while
   * editing), and the surface focusable so it can take keyboard input.
   */
  setEditing(on: boolean): void {
    this.editing = on;
    this.surface.dataset.mode = on ? 'edit' : 'browse';
    const layer = this.cardLayer;
    if (layer) layer.inert = on;
    if (on) this.surface.tabIndex = 0;
    else this.surface.removeAttribute('tabindex');
    if (!on) this.setSelected(null);
  }

  get isEditing(): boolean {
    return this.editing;
  }

  /** `data-selected-id` for the edit-mode selection (absent when nothing is selected). */
  setSelected(id: string | null): void {
    if (id === null) delete this.surface.dataset.selectedId;
    else this.surface.dataset.selectedId = id;
  }

  setCard(index: number, name: string): void {
    this.surface.dataset.cardIndex = String(index);
    this.surface.dataset.cardName = name;
  }

  setBusy(busy: boolean): void {
    this.surface.dataset.busy = busy ? 'true' : 'false';
  }
}
