/** Canonical card size in logical pixels (original Mac screen). Never change these values. */
export const CARD_WIDTH = 512;
export const CARD_HEIGHT = 342;

/**
 * Scale factor that fits the 512 × 342 card into the available area.
 * Integer scaling at 1× and above keeps logical pixels crisp; smaller areas shrink
 * fractionally so the card is never clipped. Degenerate sizes fall back to 1×.
 */
export function computeScale(availW: number, availH: number): number {
  const raw = Math.min(availW / CARD_WIDTH, availH / CARD_HEIGHT);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return raw >= 1 ? Math.floor(raw) : raw;
}
