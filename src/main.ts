// NecroCard entry point: browse and edit modes, stack picker, New Stack, message box, stack library.
import './assets/fonts/fonts.css';
import './ui/variables.css';
import './ui/chrome.css';
import './ui/browse/browse.css';
import './ui/edit/edit.css';
import './ui/script-editor/script-editor.css';
import './ui/summon/summon.css';
import './ui/share/share.css';
import { loadFixture, type FixtureName } from './model/fixtures.js';
import type { Stack } from './model/types.js';
import { CardStage } from './ui/browse/stage.js';
import { BrowseRuntime, type StatusLine } from './ui/browse/runtime.js';
import {
  createStackPicker, urlWithFixture, type PickerChoice,
} from './ui/browse/stackPicker.js';
import { createDeleteControl } from './ui/browse/libraryControls.js';
import { createPersist, type OpenTarget } from './ui/browse/persist.js';
import { EditController } from './ui/edit/editor.js';
import { createModeToggle } from './ui/edit/modeToggle.js';
import { createNewStack } from './ui/edit/newStack.js';
import { MessageBoxInput } from './ui/script-editor/messageBoxInput.js';
import { SettingsDialog } from './ui/summon/settingsDialog.js';
import { SummonDialog } from './ui/summon/summonDialog.js';
import { ShareDialog } from './ui/share/shareDialog.js';
import { createAgentClient } from './summon/agentClient.js';
import { createDirectTransport, KEY_STORAGE, testDirectKey } from './summon/directTransport.js';
import { createServerTransport } from './summon/serverTransport.js';
import type { Transport } from './summon/transport.js';
import { createWakeState } from './summon/wake.js';
import { chooseInitialLoad, createLibrary, DEFAULT_FIXTURE, type StorageLike } from './share/library.js';
import { decodeStack } from './share/codec.js';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** localStorage wrapped so a disabled or full store never throws (privacy mode, quota). For the key callers. */
const safeStorage: StorageLike & { getItem(k: string): string | null } = {
  getItem: k => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* unavailable */ } },
  removeItem: k => { try { localStorage.removeItem(k); } catch { /* nothing stored */ } },
};

/** The library needs to detect a quota failure, so its setItem rethrows; reads and removes still swallow. */
const libraryStorage: StorageLike = {
  getItem: k => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: k => { try { localStorage.removeItem(k); } catch { /* nothing stored */ } },
};

/** The key is read from local storage only, at call time (summon REQ-4.3). */
function readStoredKey(): string | null {
  const key = safeStorage.getItem(KEY_STORAGE);
  return key && key.trim() !== '' ? key : null;
}

const keyStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem: k => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: k => { try { localStorage.removeItem(k); } catch { /* nothing stored */ } },
};

function boot(root: HTMLElement): void {
  root.className = 'app';

  // Summon wiring (summon REQ-7): Direct when a key is stored, Server otherwise, chosen per call.
  const apiBase: string = import.meta.env.VITE_API_URL ?? '';
  const serverTransport = createServerTransport(apiBase);
  const directTransport = createDirectTransport(readStoredKey);
  const transportFor = (): Transport => (readStoredKey() ? directTransport : serverTransport);
  const wake = createWakeState(apiBase);
  if (!readStoredKey()) wake.start();

  const library = createLibrary({ storage: libraryStorage });
  // What is open: a bundled sample (no entry yet) or a library entry. Set before any load completes.
  let openTarget: OpenTarget = { kind: 'sample' };

  const toolbar = document.createElement('header');
  toolbar.className = 'chrome-toolbar';
  const title = document.createElement('h1');
  title.className = 'chrome-title';
  title.textContent = 'NecroCard';

  const editToolbarHost = document.createElement('div');
  editToolbarHost.className = 'edit-toolbar-host';
  editToolbarHost.hidden = true;

  const stage = new CardStage();
  const workspace = document.createElement('div');
  workspace.className = 'workspace';
  workspace.append(stage.viewport);

  const statusEl = document.createElement('div');
  statusEl.className = 'status-line';
  statusEl.setAttribute('role', 'alert');
  const status: StatusLine = {
    show: message => { statusEl.textContent = message; },
    clear: () => { statusEl.textContent = ''; },
  };

  const messageBoxInput = new MessageBoxInput();
  const messageBox = messageBoxInput.input;

  const picker = createStackPicker(choice => { void onPickerChoice(choice); });

  /** Rebuild "My stacks" from the library and select the open stack. */
  function refreshPicker(): void {
    const records = library.list();
    picker.setEntries(records);
    if (openTarget.kind === 'entry') {
      picker.setSelected(openTarget.id);
      const id = openTarget.id;
      deleteControl.setName(records.find(r => r.id === id)?.name ?? '');
    }
  }

  const newStackButton = document.createElement('button');
  newStackButton.type = 'button';
  newStackButton.className = 'chrome-button';
  newStackButton.textContent = 'New Stack';

  const deleteControl = createDeleteControl({ onConfirm: () => { void onDeleteConfirmed(); } });

  const summonButton = document.createElement('button');
  summonButton.type = 'button';
  summonButton.className = 'chrome-button';
  summonButton.textContent = 'Summon';

  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'chrome-button';
  settingsButton.textContent = 'Settings';

  const shareButton = document.createElement('button');
  shareButton.type = 'button';
  shareButton.className = 'chrome-button';
  shareButton.textContent = 'Share';

  let summoning = false;
  const updateToolbar = () => {
    const busy = runtime.isBusy || summoning;
    picker.setDisabled(busy);
    newStackButton.disabled = busy;
    summonButton.disabled = busy;
    shareButton.disabled = busy;
    deleteControl.setEnabled(openTarget.kind === 'entry' && !busy);
    toggle.setDisabled(busy);
    messageBox.disabled = busy || editor.mode === 'edit';
  };

  const toggle = createModeToggle(mode => {
    if (mode === 'edit') { runtime.stopSound(); editor.enter(); }
    else editor.exit();
  });

  const runtime = new BrowseRuntime(stage, status, {
    dialogInert: () => [messageBox, toolbar],
    onBusyChange: () => updateToolbar(),
    onLoad: () => editor.reset(),
    onFieldEdited: () => persist.persist('browse-typing'),
  });

  const editor = new EditController({
    stage, runtime, status, messageBox,
    inspectorHost: workspace,
    toolbarHost: editToolbarHost,
    onModeChange: mode => toggle.set(mode),
    agent: createAgentClient(transportFor),
    onChange: () => {
      const s = runtime.currentStack;
      if (!s) return;
      stage.setTitle(s.name); // a rename in the inspector (or its undo) shows in the window title at once
      persist.persist('authored');
    },
  });

  const persist = createPersist({
    library,
    currentStack: () => runtime.currentStack,
    showStatus: m => status.show(m),
    getTarget: () => openTarget,
    setTarget: t => { openTarget = t; updateToolbar(); },
    onFork: () => leaveFixtureLink(),
    onLibraryChanged: () => refreshPicker(),
  });
  const flushPersist = () => persist.flush();
  addEventListener('pagehide', flushPersist);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPersist(); });

  /** Bumped by every load, so a slow fixture import cannot replace a newer New Stack or Summon. */
  let loadSeq = 0;

  /** A person has edited a sample reached via ?stack=, so drop the link; a reload then reopens their copy. */
  function leaveFixtureLink(): void {
    const url = new URL(location.href);
    if (!url.searchParams.has('stack')) return;
    url.searchParams.delete('stack');
    history.replaceState(null, '', url.toString());
  }

  /** Load any stack like a fixture: Browse mode, history cleared. Flushes a pending save first. */
  async function loadStack(stack: Stack): Promise<boolean> {
    if (runtime.isBusy) return false;
    loadSeq++;
    runtime.stopSound();        // a melody never crosses a stack change (necrotalk-play REQ-3.3)
    persist.flush();
    editor.reset();
    stage.setTitle(stack.name);
    return runtime.load(stack);
  }

  /** Open a bundled sample. No library write until the first authored edit forks a copy. */
  async function loadFixtureKey(key: FixtureName): Promise<void> {
    if (runtime.isBusy) { refreshPicker(); picker.setSelected(key); return; }
    const seq = ++loadSeq;
    try {
      const stack = await loadFixture(key);
      if (seq !== loadSeq) return;
      if (!(await loadStack(stack))) { refreshPicker(); return; }
      openTarget = { kind: 'sample' };
      library.setLastOpened({ kind: 'fixture', key });
      updateToolbar();
      refreshPicker();
      picker.setSelected(key);
      history.replaceState(null, '', urlWithFixture(location.href, key));
    } catch (e) {
      console.error(e);
      refreshPicker();
      status.show(`Could not load stack: ${messageOf(e)}`);
    }
  }

  /** Open an existing library entry by id. */
  async function openEntry(id: string): Promise<void> {
    if (runtime.isBusy) { refreshPicker(); return; }
    const entry = library.open(id);
    if (!entry) { status.show('That stack could not be opened; opening the sample stack.'); void loadFixtureKey(DEFAULT_FIXTURE); return; }
    if (!(await loadStack(entry.stack))) { refreshPicker(); return; }
    openTarget = { kind: 'entry', id };
    library.setLastOpened({ kind: 'entry', id });
    leaveFixtureLink();
    updateToolbar();
    refreshPicker();
  }

  function onPickerChoice(choice: PickerChoice): Promise<void> {
    return choice.kind === 'fixture' ? loadFixtureKey(choice.key) : openEntry(choice.id);
  }

  /** Create a library entry from a stack and open it in Edit mode (Summon, Import, New Stack). */
  async function createEntryInEdit(stack: Stack, enterEdit: boolean): Promise<void> {
    if (!(await loadStack(stack))) throw new Error('A script is still running. Try again when it finishes.');
    const r = library.create(stack, stack.name);
    if (!r.ok) {
      status.show('Your library is full; that stack was not saved.');
      openTarget = { kind: 'sample' }; // nothing persisted; treat as unsaved
    } else {
      openTarget = { kind: 'entry', id: r.entry.id };
      library.setLastOpened({ kind: 'entry', id: r.entry.id });
    }
    leaveFixtureLink();
    updateToolbar();
    refreshPicker();
    if (enterEdit && !editor.enter()) {
      status.show('The stack is loaded. Switch to Edit when its opening scripts finish.');
    }
  }

  newStackButton.addEventListener('click', () => {
    void (async () => {
      if (runtime.isBusy) return;
      let stack: Stack;
      try {
        stack = createNewStack();
      } catch (e) {
        status.show(`Could not create stack: ${messageOf(e)}`);
        return;
      }
      await createEntryInEdit(stack, true);
    })();
  });

  async function onDeleteConfirmed(): Promise<void> {
    if (openTarget.kind !== 'entry') return;
    library.delete(openTarget.id);
    await loadFixtureKey(DEFAULT_FIXTURE);
  }

  const summonDialog = new SummonDialog({
    transport: transportFor,
    wake,
    onLoaded: stack => createEntryInEdit(stack, true),
    onBusyChange: pending => { summoning = pending; updateToolbar(); },
  });
  const settingsDialog = new SettingsDialog({
    storage: keyStorage,
    testKey: (key, signal) => testDirectKey(key, signal),
  });
  const shareDialog = new ShareDialog({
    currentStack: () => {
      const s = runtime.currentStack;
      if (!s) throw new Error('No stack is loaded');
      return s;
    },
    onImported: stack => createEntryInEdit(stack, true),
  });
  summonButton.addEventListener('click', () => { if (!runtime.isBusy) summonDialog.open(); });
  settingsButton.addEventListener('click', () => settingsDialog.open());
  shareButton.addEventListener('click', () => {
    if (!runtime.isBusy && runtime.currentStack) shareDialog.open();
  });

  messageBox.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || runtime.isBusy || editor.mode === 'edit') return;
    e.preventDefault();
    const line = messageBox.value;
    messageBoxInput.submitted(line);
    void runtime.runMessageBox(line).then(() => {
      persist.persist('authored'); // the message box is a person action (may mutate the stack)
      messageBox.focus();
      messageBox.select();
    });
  });

  /** Open a stack shared in the URL fragment: it becomes a library entry (single load path). */
  async function openShared(encoded: string): Promise<void> {
    let stack: Stack;
    try {
      stack = await decodeStack(encoded);
    } catch {
      status.show('That shared link could not be opened; opening the sample stack.');
      void loadFixtureKey(DEFAULT_FIXTURE);
      return;
    }
    // Clear the fragment first so a reload falls through to the last-open entry (this new one).
    history.replaceState(null, '', `${location.origin}${location.pathname}`);
    await createEntryInEdit(stack, false);
  }

  toolbar.append(title, picker.el, newStackButton, deleteControl.button, summonButton, shareButton, settingsButton, toggle.el);
  root.replaceChildren(toolbar, editToolbarHost, workspace, statusEl, messageBoxInput.el);
  stage.observe();
  refreshPicker();

  // Initial load (REQ-5.1): share fragment, then ?stack=, then the last-open stack, then the quiz.
  const initial = chooseInitialLoad(location, { storage: libraryStorage });
  if (initial.corruptAutosave || initial.corruptIndex) {
    status.show('Your saved stack could not be read; opening the sample stack.');
  }
  switch (initial.load.source) {
    case 'share':
      void openShared(initial.load.encoded);
      break;
    case 'fixture':
      void loadFixtureKey(initial.load.key);
      break;
    case 'library':
      void openEntry(initial.load.entry.id);
      break;
    case 'default':
      void loadFixtureKey(DEFAULT_FIXTURE);
      break;
  }

  // A share link pasted into an already-open tab only changes the fragment; handle it here.
  addEventListener('hashchange', () => {
    const encoded = new URLSearchParams(location.hash.replace(/^#/, '')).get('s');
    if (encoded && encoded.trim() !== '' && !runtime.isBusy) void openShared(encoded);
  });
}

const root = document.getElementById('app');
if (root) boot(root);
