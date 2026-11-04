import { applyRect } from '../browse/objectEl.js';
import { hitHandle, hitTest } from './geometry.js';
import { clientToLogical, dragRect, isNoop, type Drag } from './pointer.js';
import type { EditController } from './editor.js';

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** True when the key event belongs to a text control or an open dialog (not to the editor). */
function inEditableControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE) !== null;
}

/**
 * Pointer and keyboard handling for edit mode (REQ-2, REQ-3, REQ-4.5, REQ-7.3).
 * Returns a function that removes every listener.
 */
export function bindEditorInput(ctrl: EditController): () => void {
  const { stage } = ctrl.deps;
  const overlay = ctrl.overlay.el;
  const doc = stage.surface.ownerDocument;
  let drag: Drag | null = null;

  const logical = (e: PointerEvent | MouseEvent) =>
    clientToLogical(e, stage.surface.getBoundingClientRect(), stage.currentScale);

  const active = () => ctrl.session!.activeObjects();

  const preview = (d: Drag, rect: { x: number; y: number; w: number; h: number }) => {
    const el = ctrl.host.elementFor(d.id);
    if (el) applyRect(el, rect);
    ctrl.overlay.showSelection(rect);
  };

  const cancelDrag = (): boolean => {
    if (!drag) return false;
    preview(drag, drag.start);
    drag = null;
    return true;
  };

  const selectOnly = (id: string | null) => {
    ctrl.flush();
    ctrl.session!.select(id);
    ctrl.refresh({ render: false });
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !ctrl.session) return;
    e.preventDefault();
    stage.surface.focus({ preventScroll: true });
    const p = logical(e);
    const selected = ctrl.session.selected();
    const handle = selected ? hitHandle(selected.rect, p.x, p.y) : null;
    const startClient = { x: e.clientX, y: e.clientY };
    if (selected && handle) {
      ctrl.flush();
      drag = { kind: 'resize', id: selected.id, handle, start: { ...selected.rect }, startClient };
    } else {
      const hit = hitTest(active(), p.x, p.y);
      selectOnly(hit?.id ?? null);
      drag = hit ? { kind: 'move', id: hit.id, start: { ...hit.rect }, startClient } : null;
    }
    if (drag) {
      try { overlay.setPointerCapture(e.pointerId); } catch { /* synthetic events have no pointer */ }
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (drag) preview(drag, dragRect(drag, e.clientX, e.clientY, stage.currentScale));
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    const rect = dragRect(d, e.clientX, e.clientY, stage.currentScale);
    if (isNoop(d.start, rect)) return;
    ctrl.op(s => s.moveTo(d.id, rect, d.kind));
  };

  const onDoubleClick = (e: MouseEvent) => {
    if (!ctrl.session) return;
    const p = logical(e);
    const hit = hitTest(active(), p.x, p.y);
    if (!hit) return;
    selectOnly(hit.id);
    ctrl.inspector.focusScript();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const s = ctrl.session;
    if (!s || ctrl.mode !== 'edit' || doc.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const editable = inEditableControl(e.target);

    if (mod && (key === 'z' || key === 'y')) {
      if (editable) return; // native text undo inside inputs
      e.preventDefault();
      ctrl.op(ss => ((key === 'z' && !e.shiftKey) ? ss.undo() : ss.redo()));
      return;
    }
    if (mod && key === 'b' && !e.shiftKey && !e.altKey) {
      if (editable) return; // leave the browser's Ctrl+B to text controls
      e.preventDefault(); // only when consumed in Edit mode (edit-background REQ-1.1)
      ctrl.toggleBackground();
      return;
    }
    if (editable) return;
    // Keys below act on the card only when focus is on the card surface or nowhere in particular.
    const onCard = e.target === doc.body || e.target === doc.documentElement
      || (e.target instanceof Node && stage.surface.contains(e.target));
    if (!onCard) return;

    if (e.key === 'Escape') {
      if (!cancelDrag()) selectOnly(null);
      e.preventDefault();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!s.selected()) return;
      e.preventDefault();
      ctrl.op(ss => ss.deleteSelected());
    } else if (e.key.startsWith('Arrow')) {
      if (!s.selected() || mod || e.altKey) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      ctrl.op(ss => ss.nudge(dx, dy));
    } else if (e.key === 'Tab' && e.target === stage.surface && !mod && !e.altKey) {
      const objects = active();
      if (objects.length === 0) return;
      e.preventDefault();
      const i = objects.findIndex(o => o.id === s.selection);
      const next = i === -1 ? (e.shiftKey ? objects.length - 1 : 0)
        : (i + (e.shiftKey ? -1 : 1) + objects.length) % objects.length;
      selectOnly(objects[next].id);
    }
  };

  const onPointerCancel = () => { cancelDrag(); };

  overlay.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('pointermove', onPointerMove);
  overlay.addEventListener('pointerup', onPointerUp);
  overlay.addEventListener('pointercancel', onPointerCancel);
  overlay.addEventListener('dblclick', onDoubleClick);
  doc.addEventListener('keydown', onKeyDown);
  ctrl.cancelDrag = () => { cancelDrag(); };
  return () => {
    drag = null;
    ctrl.cancelDrag = null;
    overlay.removeEventListener('pointerdown', onPointerDown);
    overlay.removeEventListener('pointermove', onPointerMove);
    overlay.removeEventListener('pointerup', onPointerUp);
    overlay.removeEventListener('pointercancel', onPointerCancel);
    overlay.removeEventListener('dblclick', onDoubleClick);
    doc.removeEventListener('keydown', onKeyDown);
  };
}
