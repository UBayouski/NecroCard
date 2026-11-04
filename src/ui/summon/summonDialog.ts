// The Summon panel (summon REQ-8.1–8.3): a prompt, three examples, progress, failures, the active path and the
// remaining daily count. All text is set with textContent.
import type { Stack } from '../../model/types.js';
import { LIMITS } from '../../summon/contract.js';
import { summonStack, SummonError, type SummonOptions, type SummonProgress } from '../../summon/pipeline.js';
import { TransportError, type Remaining, type Transport } from '../../summon/transport.js';
import type { WakeState } from '../../summon/wake.js';
import { chromeButton, createDialogShell, type DialogShell } from './dialogShell.js';

export const EXAMPLE_PROMPTS: readonly string[] = [
  'A two-card quiz about haunted houses with a score field and a Results card.',
  'A choose-your-own-adventure in a crypt with three rooms and a way out.',
  'Flashcards for five Halloween words: show the word, click to reveal the meaning, Next and Prev buttons.',
];

export const PROGRESS_TEXT = {
  waking: 'Waking the server…',
  summoning: 'Summoning…',
  validating: 'Validating…',
  retrying: 'Retrying…',
} as const;

export const PATH_TEXT = { server: 'Using the NecroCard server', direct: 'Using your Gemini key' } as const;

export interface SummonDialogDeps {
  /** Called on every summon, so a key saved in Settings takes effect at once. */
  transport: () => Transport;
  wake: Pick<WakeState, 'status' | 'remainingDay' | 'start' | 'whenSettled'>;
  /** Load the stack (Edit mode, picker entry). The dialog closes when it resolves. */
  onLoaded(stack: Stack): Promise<void>;
  /** True while a summon is pending (the toolbar disables itself). */
  onBusyChange?(busy: boolean): void;
  /** Injectable for tests. */
  summon?: (prompt: string, transport: Transport, options: SummonOptions) => Promise<Stack>;
}

export class SummonDialog {
  private readonly shell: DialogShell;
  readonly textarea: HTMLTextAreaElement;
  private readonly examples: HTMLButtonElement[];
  private readonly summonButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly pathEl: HTMLElement;
  private readonly remainingEl: HTMLElement;
  private readonly progressEl: HTMLElement;
  private readonly errorEl: HTMLElement;
  private controller: AbortController | null = null;
  private remaining: number | undefined;
  private phase: SummonProgress | null = null;

  constructor(private readonly deps: SummonDialogDeps, doc: Document = document) {
    this.shell = createDialogShell('summon-panel', 'Summon a stack', () => this.cancel(), doc);
    const body = this.shell.body;

    const status = doc.createElement('p');
    status.className = 'summon-path';
    this.pathEl = doc.createElement('span');
    this.remainingEl = doc.createElement('span');
    this.remainingEl.className = 'summon-remaining';
    status.append(this.pathEl, this.remainingEl);

    const label = doc.createElement('label');
    label.className = 'summon-label';
    label.textContent = 'Describe your stack';
    this.textarea = doc.createElement('textarea');
    this.textarea.className = 'summon-prompt';
    this.textarea.rows = 5;
    this.textarea.maxLength = LIMITS.prompt;
    this.textarea.placeholder = 'A quiz, a story, flashcards, a tiny tool…';
    label.append(this.textarea);

    const exampleList = doc.createElement('div');
    exampleList.className = 'summon-examples';
    exampleList.setAttribute('role', 'group');
    exampleList.setAttribute('aria-label', 'Example prompts');
    const exampleTitle = doc.createElement('span');
    exampleTitle.textContent = 'Try an example:';
    exampleList.append(exampleTitle);
    this.examples = EXAMPLE_PROMPTS.map(text => {
      const b = chromeButton(doc, text, 'summon-example');
      b.addEventListener('click', () => {
        this.textarea.value = text;
        this.textarea.focus();
      });
      return b;
    });
    exampleList.append(...this.examples);

    this.progressEl = doc.createElement('p');
    this.progressEl.className = 'summon-progress';
    this.progressEl.setAttribute('aria-live', 'polite');
    this.errorEl = doc.createElement('div');
    this.errorEl.className = 'summon-error';
    this.errorEl.setAttribute('role', 'alert');

    const actions = doc.createElement('div');
    actions.className = 'summon-actions';
    this.summonButton = chromeButton(doc, 'Summon', 'summon-go');
    this.summonButton.addEventListener('click', () => { void this.run(); });
    this.cancelButton = chromeButton(doc, 'Close', 'summon-cancel');
    this.cancelButton.addEventListener('click', () => this.cancel());
    actions.append(this.summonButton, this.cancelButton);

    body.append(status, label, exampleList, this.progressEl, this.errorEl, actions);
  }

  get dialog(): HTMLDialogElement {
    return this.shell.dialog;
  }
  get isOpen(): boolean {
    return this.shell.isOpen;
  }
  get isPending(): boolean {
    return this.controller !== null;
  }

  open(): void {
    const transport = this.deps.transport();
    if (transport.path === 'server') this.deps.wake.start();
    this.remaining ??= this.deps.wake.remainingDay;
    this.showPath(transport);
    this.shell.open();
    this.textarea.focus();
  }

  /** Cancel aborts a pending summon; otherwise it closes the dialog. */
  cancel(): void {
    if (this.controller) {
      this.controller.abort();
      return;
    }
    this.shell.close();
  }

  private showPath(transport: Transport): void {
    this.pathEl.textContent = PATH_TEXT[transport.path];
    const show = transport.path === 'server' && this.remaining !== undefined;
    this.remainingEl.hidden = !show;
    this.remainingEl.textContent = show ? ` · Requests left today: ${this.remaining}` : '';
  }

  private setRemaining(remaining: Remaining | undefined, transport: Transport): void {
    if (remaining) this.remaining = remaining.day;
    this.showPath(transport);
  }

  private setPending(pending: boolean): void {
    this.textarea.disabled = pending;
    this.summonButton.disabled = pending;
    for (const b of this.examples) b.disabled = pending;
    this.cancelButton.textContent = pending ? 'Cancel' : 'Close';
    this.deps.onBusyChange?.(pending);
  }

  private showProgress(transport: Transport): void {
    const waking = this.phase === 'summoning' && transport.path === 'server' && this.deps.wake.status === 'waking';
    this.progressEl.textContent = this.phase ? (waking ? PROGRESS_TEXT.waking : PROGRESS_TEXT[this.phase]) : '';
  }

  private showErrors(lines: readonly string[], heading?: string): void {
    const doc = this.errorEl.ownerDocument;
    this.errorEl.replaceChildren();
    if (heading) {
      const p = doc.createElement('p');
      p.textContent = heading;
      this.errorEl.append(p);
    }
    if (lines.length === 1 && !heading) {
      const p = doc.createElement('p');
      p.textContent = lines[0];
      this.errorEl.append(p);
      return;
    }
    const ul = doc.createElement('ul');
    for (const line of lines) {
      const li = doc.createElement('li');
      li.textContent = line;
      ul.append(li);
    }
    this.errorEl.append(ul);
  }

  /** Summon from the textarea. Resolves when the attempt has finished, whatever the outcome. */
  async run(): Promise<void> {
    if (this.controller) return;
    const prompt = this.textarea.value.trim();
    if (prompt === '') {
      this.showErrors(['Describe the stack you want first.']);
      this.textarea.focus();
      return;
    }
    const transport = this.deps.transport();
    if (transport.path === 'server') this.deps.wake.start();
    this.showPath(transport);
    this.errorEl.replaceChildren();
    const controller = new AbortController();
    this.controller = controller;
    this.setPending(true);
    void this.deps.wake.whenSettled().then(() => {
      if (this.controller === controller) this.showProgress(transport);
    });
    const summon = this.deps.summon ?? summonStack;
    try {
      const stack = await summon(prompt, transport, {
        signal: controller.signal,
        onProgress: p => {
          this.phase = p;
          this.showProgress(transport);
        },
        onReply: reply => this.setRemaining(reply.remaining, transport),
      });
      this.progressEl.textContent = 'Loading…';
      await this.deps.onLoaded(stack);
      this.textarea.value = '';
      this.finish();
      this.shell.close();
    } catch (e) {
      this.finish();
      if (e instanceof Error && e.name === 'AbortError') return;
      if (e instanceof SummonError) {
        this.showErrors(e.failures, 'The summoned stack did not pass the checks:');
      } else if (e instanceof TransportError) {
        this.setRemaining(e.remaining, transport);
        this.showErrors([e.message]);
      } else {
        this.showErrors([`Summon failed: ${e instanceof Error ? e.message : String(e)}`]);
      }
    }
  }

  private finish(): void {
    this.controller = null;
    this.phase = null;
    this.progressEl.textContent = '';
    this.setPending(false);
  }
}
