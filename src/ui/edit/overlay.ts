import type { Card, CardObject, Rect } from '../../model/types.js';
import { applyRect } from '../browse/objectEl.js';
import { HANDLE_SIZE, HANDLES, handlePoints } from './geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const CURSOR: Record<string, string> = {
  nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew',
};

/**
 * Edit-mode overlay on the card surface (REQ-2.1, REQ-2.4): dotted outlines for hidden card
 * objects, and for the selection a 1px dashed outline (4px dash, 4px gap) with eight 4 × 4
 * handles. Everything is 1-bit and positioned in logical pixels, so it scales with the card.
 */
export class EditOverlay {
  readonly el: HTMLDivElement;
  private readonly hiddenLayer: HTMLDivElement;
  private readonly selection: HTMLDivElement;
  private readonly outline: SVGSVGElement;
  private readonly outlineRect: SVGRectElement;
  private readonly handles = new Map<string, HTMLDivElement>();

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'edit-overlay';
    this.hiddenLayer = document.createElement('div');
    this.hiddenLayer.className = 'edit-hidden-layer';
    this.selection = document.createElement('div');
    this.selection.className = 'edit-selection';
    this.selection.hidden = true;

    this.outline = document.createElementNS(SVG_NS, 'svg');
    this.outline.classList.add('edit-outline');
    this.outline.setAttribute('aria-hidden', 'true');
    this.outlineRect = document.createElementNS(SVG_NS, 'rect');
    this.outlineRect.setAttribute('x', '0.5');
    this.outlineRect.setAttribute('y', '0.5');
    this.outlineRect.setAttribute('fill', 'none');
    this.outlineRect.setAttribute('stroke', '#000000');
    this.outlineRect.setAttribute('stroke-width', '1');
    this.outlineRect.setAttribute('stroke-dasharray', '4 4');
    this.outlineRect.setAttribute('shape-rendering', 'crispEdges');
    this.outline.append(this.outlineRect);
    this.selection.append(this.outline);

    for (const h of HANDLES) {
      const handle = document.createElement('div');
      handle.className = `edit-handle edit-handle--${CURSOR[h]}`;
      handle.dataset.handle = h;
      this.handles.set(h, handle);
      this.selection.append(handle);
    }
    this.el.append(this.hiddenLayer, this.selection);
  }

  /** Redraw for the current card and selection. */
  render(card: Card, selected: CardObject | null): void {
    this.hiddenLayer.replaceChildren(...card.objects.filter(o => !o.visible).map(o => {
      const outline = document.createElement('div');
      outline.className = 'edit-hidden-outline';
      outline.dataset.objectId = o.id;
      applyRect(outline, o.rect);
      return outline;
    }));
    this.showSelection(selected ? selected.rect : null);
  }

  /** Position the selection outline and handles at `rect` (also used for live drag previews). */
  showSelection(rect: Rect | null): void {
    if (!rect) {
      this.selection.hidden = true;
      return;
    }
    this.selection.hidden = false;
    applyRect(this.outline as unknown as HTMLElement, rect);
    this.outline.setAttribute('width', String(rect.w));
    this.outline.setAttribute('height', String(rect.h));
    this.outlineRect.setAttribute('width', String(Math.max(0, rect.w - 1)));
    this.outlineRect.setAttribute('height', String(Math.max(0, rect.h - 1)));
    const points = handlePoints(rect);
    const half = HANDLE_SIZE / 2;
    for (const h of HANDLES) {
      applyRect(this.handles.get(h)!, { x: points[h].x - half, y: points[h].y - half, w: HANDLE_SIZE, h: HANDLE_SIZE });
    }
  }
}
