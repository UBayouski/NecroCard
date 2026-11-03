export const HISTORY_SIZE = 50;

/**
 * Message box history (REQ-7): the last 50 submitted lines, oldest first. Up walks back, Down
 * walks forward, and Down past the newest entry returns the text typed before browsing began.
 */
export class LineHistory {
  private items: string[] = [];
  /** Index into items while browsing; items.length means "not browsing". */
  private cursor = 0;
  private draft = '';

  constructor(private readonly cap = HISTORY_SIZE) {}

  get entries(): readonly string[] { return this.items; }

  /** Record a submitted line (ignores empty lines and an exact repeat of the newest entry). */
  push(line: string): void {
    if (line.trim() !== '' && this.items[this.items.length - 1] !== line) {
      this.items.push(line);
      if (this.items.length > this.cap) this.items.shift();
    }
    this.reset();
  }

  /** Leave browsing mode (after a submit, or when the user edits a recalled line and submits). */
  reset(): void {
    this.cursor = this.items.length;
    this.draft = '';
  }

  /** The previous entry, or null at the oldest. `current` is saved as the draft on the first Up. */
  up(current: string): string | null {
    if (this.items.length === 0 || this.cursor === 0) return null;
    if (this.cursor === this.items.length) this.draft = current;
    this.cursor -= 1;
    return this.items[this.cursor];
  }

  /** The next entry; past the newest, the saved draft; then null. */
  down(): string | null {
    if (this.cursor >= this.items.length) return null;
    this.cursor += 1;
    return this.cursor === this.items.length ? this.draft : this.items[this.cursor];
  }
}
