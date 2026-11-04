import type { Card, CardObject, Rect } from '../../model/types.js';
import { applyRect } from '../browse/objectEl.js';
import { HANDLE_SIZE, HANDLES, handlePoints } from './geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The selection outline is drawn this many pixels outside the object's rect on every side, so it clears a round
 * rect button's 2px border and shows on every button style. The handles are not inflated: they stay centred on
 * the true rect's corners and edge midpoints.
 */
export const OUTLINE_INFLATE = 2;

const CURSOR: Record<string, string> = {
  nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew',
};

/**
 * Edit-mode overlay on the card surface (REQ-2.1, REQ-2.4): dotted outlines for hidden card
 * objects, and for the selection a 1px dashed outline (4px dash, 4px gap) drawn OUTLINE_INFLATE px outside the
 * object, with eight 4 × 4 handles on the object's own rect. Everything is 1-bit and positioned in logical
 * pixels, so it scales with the card.
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
    // The outline sits OUTLINE_INFLATE px outside the rect; the handles below still use the rect itself.
    const k = OUTLINE_INFLATE;
    const outer: Rect = { x: rect.x - k, y: rect.y - k, w: rect.w + 2 * k, h: rect.h + 2 * k };
    applyRect(this.outline as unknown as HTMLElement, outer);
    this.outline.setAttribute('width', String(outer.w));
    this.outline.setAttribute('height', String(outer.h));
    this.outlineRect.setAttribute('width', String(Math.max(0, outer.w - 1)));
    this.outlineRect.setAttribute('height', String(Math.max(0, outer.h - 1)));
    const points = handlePoints(rect);
    const half = HANDLE_SIZE / 2;
    for (const h of HANDLES) {
      applyRect(this.handles.get(h)!, { x: points[h].x - half, y: points[h].y - half, w: HANDLE_SIZE, h: HANDLE_SIZE });
    }
  }
}
