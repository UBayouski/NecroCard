// Settings: the bring-your-own Gemini key (summon REQ-8.4). The key lives only in the injected storage
// (local storage in the app) and is shown masked; the input is cleared after Save.
import { KEY_STORAGE } from '../../summon/directTransport.js';
import { chromeButton, createDialogShell, type DialogShell } from './dialogShell.js';

export type KeyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SettingsDialogDeps {
  storage: KeyStorage;
  /** Resolves if Gemini accepts the key; rejects with a plain-English Error otherwise. */
  testKey(key: string, signal: AbortSignal): Promise<void>;
  /** After Save or Clear (the Summon panel's path label changes). */
  onChange?(): void;
}

export const SETTINGS_TEXT = {
  intro:
    'Summon uses the shared NecroCard server unless you add your own Gemini API key. ' +
    "Your key stays in this browser's local storage and is sent only to Google. " +
    'Use a key restricted to the Gemini API.',
  noKey: 'No key stored.',
  pasteFirst: 'Paste a key first.',
  testing: 'Testing…',
  works: 'Key works.',
  saved: 'Key saved. Summon now uses your key.',
  cleared: 'Key cleared. Summon uses the NecroCard server.',
} as const;

/** `•••• abcd`: never more than the last four characters. */
export function maskKey(key: string): string {
  return key.length > 8 ? `•••• ${key.slice(-4)}` : '••••';
}

export class SettingsDialog {
  private readonly shell: DialogShell;
  readonly input: HTMLInputElement;
  private readonly storedEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly buttons: Record<'test' | 'save' | 'clear' | 'close', HTMLButtonElement>;
  private controller: AbortController | null = null;

  constructor(private readonly deps: SettingsDialogDeps, doc: Document = document) {
    this.shell = createDialogShell('settings-panel', 'Gemini key', () => this.close(), doc);
    const intro = doc.createElement('p');
    intro.className = 'settings-intro';
    intro.textContent = SETTINGS_TEXT.intro;
    this.storedEl = doc.createElement('p');
    this.storedEl.className = 'settings-stored';

    const label = doc.createElement('label');
    label.className = 'summon-label';
    label.textContent = 'Paste a Gemini API key';
    this.input = doc.createElement('input');
    this.input.type = 'password';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.className = 'settings-key';
    label.append(this.input);

    this.statusEl = doc.createElement('p');
    this.statusEl.className = 'summon-progress';
    this.statusEl.setAttribute('aria-live', 'polite');

    this.buttons = {
      test: chromeButton(doc, 'Test'),
      save: chromeButton(doc, 'Save'),
      clear: chromeButton(doc, 'Clear'),
      close: chromeButton(doc, 'Close'),
    };
    this.buttons.test.addEventListener('click', () => { void this.test(); });
    this.buttons.save.addEventListener('click', () => this.save());
    this.buttons.clear.addEventListener('click', () => this.clear());
    this.buttons.close.addEventListener('click', () => this.close());
    const actions = doc.createElement('div');
    actions.className = 'summon-actions';
    actions.append(this.buttons.test, this.buttons.save, this.buttons.clear, this.buttons.close);

    this.shell.body.append(intro, this.storedEl, label, this.statusEl, actions);
  }

  get dialog(): HTMLDialogElement {
    return this.shell.dialog;
  }
  get isOpen(): boolean {
    return this.shell.isOpen;
  }

  private stored(): string | null {
    const key = this.deps.storage.getItem(KEY_STORAGE);
    return key && key.trim() !== '' ? key : null;
  }

  private showStored(): void {
    const key = this.stored();
    this.storedEl.textContent = key ? `Stored key: ${maskKey(key)}` : SETTINGS_TEXT.noKey;
    this.buttons.clear.disabled = key === null;
  }

  open(): void {
    this.input.value = '';
    this.statusEl.textContent = '';
    this.showStored();
    this.shell.open();
    this.input.focus();
  }

  close(): void {
    this.controller?.abort();
    this.controller = null;
    this.input.value = '';
    this.shell.close();
  }

  async test(): Promise<void> {
    const key = this.input.value.trim();
    if (key === '') {
      this.statusEl.textContent = SETTINGS_TEXT.pasteFirst;
      return;
    }
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.buttons.test.disabled = true;
    this.statusEl.textContent = SETTINGS_TEXT.testing;
    try {
      await this.deps.testKey(key, controller.signal);
      if (this.controller === controller) this.statusEl.textContent = SETTINGS_TEXT.works;
    } catch (e) {
      if (this.controller !== controller || (e instanceof Error && e.name === 'AbortError')) return;
      this.statusEl.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      if (this.controller === controller) this.controller = null;
      this.buttons.test.disabled = false;
    }
  }

  save(): void {
    const key = this.input.value.trim();
    if (key === '') {
      this.statusEl.textContent = SETTINGS_TEXT.pasteFirst;
      return;
    }
    this.deps.storage.setItem(KEY_STORAGE, key);
    this.input.value = '';
    this.statusEl.textContent = SETTINGS_TEXT.saved;
    this.showStored();
    this.deps.onChange?.();
  }

  clear(): void {
    this.deps.storage.removeItem(KEY_STORAGE);
    this.statusEl.textContent = SETTINGS_TEXT.cleared;
    this.showStored();
    this.deps.onChange?.();
  }
}
