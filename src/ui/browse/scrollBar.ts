/** Arrow and thumb size of the classic 1-bit scroll bar, in logical pixels. */
export const SCROLL_BAR_SIZE = 16;
/** One line of field text (12px font × 1.2 line height, rounded to the pixel grid). */
export const LINE_PX = 14;

/**
 * Thumb offset within the track for a given scroll state. Pure so it can be tested
 * without layout. Returns null when the content does not overflow (no thumb shown).
 */
export function thumbOffset(
  scrollTop: number, scrollHeight: number, clientHeight: number, trackHeight: number,
): number | null {
  const range = scrollHeight - clientHeight;
  if (range <= 0) return null;
  const room = Math.max(0, trackHeight - SCROLL_BAR_SIZE);
  const ratio = Math.min(1, Math.max(0, scrollTop / range));
  return Math.round(ratio * room);
}

/**
 * Attach a DOM-drawn scroll bar to a scrolling field (REQ-2.2). Arrows scroll one line,
 * a track click scrolls one page, the wheel scrolls natively (the native bar is hidden),
 * and the thumb follows `scrollTop`. `innerHeight` is the field height inside its border.
 */
export function attachScrollBar(field: HTMLElement, content: HTMLElement, innerHeight: number): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'scroll-bar';
  bar.setAttribute('aria-hidden', 'true');

  const up = document.createElement('div');
  up.className = 'scroll-arrow scroll-arrow--up';
  const track = document.createElement('div');
  track.className = 'scroll-track';
  const thumb = document.createElement('div');
  thumb.className = 'scroll-thumb';
  track.append(thumb);
  const down = document.createElement('div');
  down.className = 'scroll-arrow scroll-arrow--down';
  bar.append(up, track, down);

  const trackHeight = Math.max(0, innerHeight - 2 * SCROLL_BAR_SIZE);
  const update = () => {
    const top = thumbOffset(content.scrollTop, content.scrollHeight, content.clientHeight, trackHeight);
    thumb.hidden = top === null;
    track.classList.toggle('scroll-track--active', top !== null);
    if (top !== null) thumb.style.top = `${top}px`;
  };
  const scrollBy = (dy: number) => {
    content.scrollTop = Math.max(0, content.scrollTop + dy);
    update();
  };

  // Stop pointer events here so the scroll bar never sends mouse messages to scripts.
  bar.addEventListener('pointerdown', e => e.stopPropagation());
  bar.addEventListener('pointerup', e => e.stopPropagation());
  up.addEventListener('click', () => scrollBy(-LINE_PX));
  down.addEventListener('click', () => scrollBy(LINE_PX));
  track.addEventListener('click', e => {
    if (e.target === thumb) return;
    const page = Math.max(LINE_PX, content.clientHeight - LINE_PX);
    const thumbTop = parseFloat(thumb.style.top || '0');
    scrollBy(e.offsetY < thumbTop ? -page : page);
  });
  content.addEventListener('scroll', update);

  field.append(bar);
  update();
  return bar;
}
