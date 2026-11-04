import { invertCommand, type Command } from './commands.js';

interface Entry {
  cmd: Command;
  /** Entries with the same key merge while the top entry is open (nudge runs). */
  coalesceKey?: string;
}

export const HISTORY_CAP = 500;

/** One linear undo/redo history of edit commands (REQ-7). */
export class History {
  private done: Entry[] = [];
  private undone: Command[] = [];
  private open = false;
  /** Bumped on every content change (push, undo, redo). Lets callers detect a real mutation. */
  private rev = 0;

  constructor(private readonly cap = HISTORY_CAP) {}

  /** A monotonic counter that increases whenever a command is applied, undone or redone. */
  get revision(): number { return this.rev; }

  /**
   * Record an applied command. A setRect with the same coalesceKey as the open top entry is
   * merged into it (keeping the first `before`). Any push clears the redo stack.
   */
  push(cmd: Command, coalesceKey?: string): void {
    this.undone = [];
    this.rev++;
    const top = this.done[this.done.length - 1];
    if (this.open && coalesceKey !== undefined && top?.coalesceKey === coalesceKey
      && top.cmd.kind === 'setRect' && cmd.kind === 'setRect' && top.cmd.objectId === cmd.objectId) {
      top.cmd = { ...top.cmd, after: cmd.after };
      return;
    }
    this.done.push({ cmd, coalesceKey });
    if (this.done.length > this.cap) this.done.shift();
    this.open = coalesceKey !== undefined;
  }

  /** Stop the top entry from absorbing further pushes. */
  seal(): void {
    this.open = false;
  }

  /** Pop the last command; returns the command to apply to undo it (its inverse). */
  undo(): { apply: Command; original: Command } | null {
    this.open = false;
    const entry = this.done.pop();
    if (!entry) return null;
    this.rev++;
    this.undone.push(entry.cmd);
    return { apply: invertCommand(entry.cmd), original: entry.cmd };
  }

  /** Re-apply the most recently undone command. */
  redo(): Command | null {
    this.open = false;
    const cmd = this.undone.pop();
    if (!cmd) return null;
    this.rev++;
    this.done.push({ cmd });
    return cmd;
  }

  /** Put back an entry whose undo failed to apply (history position unchanged). */
  restoreAfterFailedUndo(): void {
    const cmd = this.undone.pop();
    if (cmd) this.done.push({ cmd });
  }

  /** Put back an entry whose redo failed to apply. */
  restoreAfterFailedRedo(): void {
    const entry = this.done.pop();
    if (entry) this.undone.push(entry.cmd);
  }

  get canUndo(): boolean { return this.done.length > 0; }
  get canRedo(): boolean { return this.undone.length > 0; }
  get size(): number { return this.done.length; }
  peekUndo(): Command | null { return this.done[this.done.length - 1]?.cmd ?? null; }
  peekRedo(): Command | null { return this.undone[this.undone.length - 1] ?? null; }

  clear(): void {
    this.done = [];
    this.undone = [];
    this.open = false;
  }
}
