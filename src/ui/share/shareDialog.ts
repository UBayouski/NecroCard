// The Share dialog (sharing REQ-4): a read-only share URL, Copy, length, a long-link warning, and Export / Import.
// Reuses the summon dialog shell and styles. All text is set with textContent.
import type { Stack } from '../../model/types.js';
import { encodeStack as defaultEncode } from '../../share/codec.js';
import { FRAGMENT_PARAM } from '../../share/library.js';
import {
  exportStack as defaultExport, pickStackFile, readStackFile, ShareImportError,
} from '../../share/file.js';
import { chromeButton, createDialogShell, type DialogShell } from '../summon/dialogShell.js';

/** Above this length, warn that chat apps may truncate the link and Export is safer. */
export const SHARE_URL_WARN = 8000;

export const SHARE_TEXT = {
  building: 'Building link…',
  warning: 'This link is very long. Some chat apps may cut it off — Export the file instead for a big stack.',
  copied: 'Link copied.',
  copyManual: 'Press Ctrl+C to copy the selected link.',
  encodeFailed: 'This stack could not be turned into a link.',
} as const;

export interface ShareDialogDeps {
  /** The live working copy to share. */
  currentStack: () => Stack;
  /** Load an imported stack (Edit mode, picker entry) — same path as a summoned stack. */
  onImported: (stack: Stack) => Promise<void>;
  encode?: (stack: Stack) => Promise<string>;
  clipboard?: { writeText(text: string): Promise<void> };
  exportStack?: (stack: Stack) => void;
  pickFile?: () => Promise<File | null>;
  read?: (file: Blob) => Promise<Stack>;
  /** The current location origin+pathname; injectable for tests. */
  baseUrl?: () => string;
}

export class ShareDialog {
  private readonly shell: DialogShell;
  readonly urlInput: HTMLInputElement;
  private readonly lengthEl: HTMLElement;
  private readonly warningEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly copyButton: HTMLButtonElement;
  private token = 0;

  constructor(private readonly deps: ShareDialogDeps, doc: Document = document) {
    this.shell = createDialogShell('share-panel', 'Share this stack', () => this.close(), doc);
    const body = this.shell.body;

    const intro = doc.createElement('p');
    intro.className = 'summon-path';
    intro.textContent = 'Anyone with this link opens a copy of the stack. The whole stack is in the link itself.';

    const label = doc.createElement('label');
    label.className = 'summon-label';
    label.textContent = 'Share link';
    this.urlInput = doc.createElement('input');
    this.urlInput.type = 'text';
    this.urlInput.readOnly = true;
    this.urlInput.className = 'share-url';
    this.urlInput.addEventListener('focus', () => this.urlInput.select());
    label.append(this.urlInput);

    this.lengthEl = doc.createElement('p');
    this.lengthEl.className = 'share-length';
    this.warningEl = doc.createElement('p');
    this.warningEl.className = 'summon-error share-warning';
    this.warningEl.textContent = SHARE_TEXT.warning;
    this.warningEl.hidden = true;
    this.statusEl = doc.createElement('p');
    this.statusEl.className = 'summon-progress';
    this.statusEl.setAttribute('aria-live', 'polite');

    this.copyButton = chromeButton(doc, 'Copy', 'share-copy');
    this.copyButton.addEventListener('click', () => { void this.copy(); });
    const exportButton = chromeButton(doc, 'Export', 'share-export');
    exportButton.addEventListener('click', () => this.runExport());
    const importButton = chromeButton(doc, 'Import', 'share-import');
    importButton.addEventListener('click', () => { void this.runImport(); });
    const closeButton = chromeButton(doc, 'Close', 'share-close');
    closeButton.addEventListener('click', () => this.close());
    const actions = doc.createElement('div');
    actions.className = 'summon-actions';
    actions.append(this.copyButton, exportButton, importButton, closeButton);

    body.append(intro, label, this.lengthEl, this.warningEl, this.statusEl, actions);
  }

  get dialog(): HTMLDialogElement {
    return this.shell.dialog;
  }
  get isOpen(): boolean {
    return this.shell.isOpen;
  }

  open(): void {
    this.statusEl.textContent = '';
    this.shell.open();
    void this.buildUrl();
  }

  close(): void {
    this.token++; // ignore any in-flight encode
    this.shell.close();
  }

  private base(): string {
    if (this.deps.baseUrl) return this.deps.baseUrl();
    return `${location.origin}${location.pathname}`;
  }

  private setLength(url: string): void {
    this.lengthEl.textContent = `${url.length} characters`;
    this.warningEl.hidden = url.length <= SHARE_URL_WARN;
  }

  private async buildUrl(): Promise<void> {
    const token = ++this.token;
    this.urlInput.value = SHARE_TEXT.building;
    this.lengthEl.textContent = '';
    this.warningEl.hidden = true;
    this.copyButton.disabled = true;
    const encode = this.deps.encode ?? defaultEncode;
    try {
      const encoded = await encode(this.deps.currentStack());
      if (token !== this.token) return;
      const url = `${this.base()}#${FRAGMENT_PARAM}=${encoded}`;
      this.urlInput.value = url;
      this.setLength(url);
      this.copyButton.disabled = false;
    } catch {
      if (token !== this.token) return;
      this.urlInput.value = '';
      this.statusEl.textContent = SHARE_TEXT.encodeFailed;
    }
  }

  private async copy(): Promise<void> {
    const url = this.urlInput.value;
    if (!url || url === SHARE_TEXT.building) return;
    const clipboard = this.deps.clipboard ?? (typeof navigator !== 'undefined' ? navigator.clipboard : undefined);
    try {
      if (!clipboard) throw new Error('no clipboard');
      await clipboard.writeText(url);
      this.statusEl.textContent = SHARE_TEXT.copied;
      return;
    } catch {
      // fall through to the manual select
    }
    this.urlInput.focus();
    this.urlInput.select();
    let copied: boolean;
    try {
      copied = this.urlInput.ownerDocument.execCommand('copy');
    } catch {
      copied = false;
    }
    this.statusEl.textContent = copied ? SHARE_TEXT.copied : SHARE_TEXT.copyManual;
  }

  private runExport(): void {
    (this.deps.exportStack ?? defaultExport)(this.deps.currentStack());
  }

  private async runImport(): Promise<void> {
    const file = await (this.deps.pickFile ?? pickStackFile)();
    if (!file) return;
    try {
      const stack = await (this.deps.read ?? readStackFile)(file);
      await this.deps.onImported(stack);
      this.close();
    } catch (e) {
      // A bad file keeps the dialog open with its message (not the app status line).
      this.statusEl.textContent = e instanceof ShareImportError ? e.message : 'That file could not be imported.';
    }
  }
}
