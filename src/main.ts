// NecroCard entry point: browse and edit modes, stack picker, New Stack, message box.
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
  createStackPicker, CUSTOM, fixtureFromSearch, UNTITLED, urlWithFixture, type PickerValue,
} from './ui/browse/stackPicker.js';
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
import { chooseInitialLoad, createAutosave, DEFAULT_FIXTURE, type StorageLike } from './share/autosave.js';
import { decodeStack } from './share/codec.js';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** localStorage wrapped so a disabled or full store never throws (privacy mode, quota). */
const safeStorage: StorageLike & { getItem(k: string): string | null } = {
  getItem: k => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* unavailable */ } },
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
  // Wake a sleeping Render service once; never blocks rendering, failures are silent.
  if (!readStoredKey()) wake.start();

  const autosave = createAutosave(safeStorage);
  // Persist the open stack before the page is hidden, in case an edit is still inside the debounce.
  const flushAutosave = () => autosave.flush();
  addEventListener('pagehide', flushAutosave);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAutosave(); });

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

  // Highlighted message box with an Up/Down history (script-editor REQ-7).
  const messageBoxInput = new MessageBoxInput();
  const messageBox = messageBoxInput.input;

  let current: PickerValue = fixtureFromSearch(location.search);
  const picker = createStackPicker(key => { void loadKey(key); });
  picker.setValue(current);

  const newStackButton = document.createElement('button');
  newStackButton.type = 'button';
  newStackButton.className = 'chrome-button';
  newStackButton.textContent = 'New Stack';

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

  /** Toolbar controls are disabled while scripts run or a summon is pending. */
  let summoning = false;
  const updateToolbar = () => {
    const busy = runtime.isBusy || summoning;
    picker.setDisabled(busy);
    newStackButton.disabled = busy;
    summonButton.disabled = busy;
    shareButton.disabled = busy;
    toggle.setDisabled(busy);
    messageBox.disabled = busy || editor.mode === 'edit';
  };

  // `editor` is declared below; these callbacks only run after it exists.
  const toggle = createModeToggle(mode => {
    if (mode === 'edit') editor.enter();
    else editor.exit();
  });

  const runtime = new BrowseRuntime(stage, status, {
    dialogInert: () => [messageBox, toolbar],
    onBusyChange: () => updateToolbar(),
    onLoad: () => editor.reset(),
    onFieldEdited: () => {
      const s = runtime.currentStack;
      if (!s) return;
      leaveFixtureLink();
      autosave.save(s);
    },
  });

  const editor = new EditController({
    stage, runtime, status, messageBox,
    inspectorHost: workspace,
    toolbarHost: editToolbarHost,
    onModeChange: mode => toggle.set(mode),
    agent: createAgentClient(transportFor),
    // Autosave person-made edits (sharing REQ-2.1). Debounced; button scripts do not call this.
    onChange: () => {
      const s = runtime.currentStack;
      if (!s) return;
      stage.setTitle(s.name); // a rename in the inspector (or its undo) shows in the window title at once
      leaveFixtureLink();
      autosave.save(s);
    },
  });

  /** Bumped by every load, so a slow fixture import cannot replace a newer New Stack or Summon. */
  let loadSeq = 0;

  /**
   * `?stack=` is an explicit "open this sample" link, and it outranks the autosave on page load. Once a person has
   * changed the stack it is theirs, so drop the link: a reload then restores their autosave instead of resetting to
   * the pristine sample. (Playing without editing keeps the link, so a reload still starts the sample fresh.)
   */
  function leaveFixtureLink(): void {
    const url = new URL(location.href);
    if (!url.searchParams.has('stack')) return;
    url.searchParams.delete('stack');
    history.replaceState(null, '', url.toString());
  }

  /** Load any stack exactly like a fixture: Browse mode, history cleared (REQ-1.4). Autosaves by default. */
  async function loadStack(stack: Stack, opts: { autosave?: boolean } = {}): Promise<boolean> {
    if (runtime.isBusy) return false;
    loadSeq++;
    editor.reset();
    stage.setTitle(stack.name); // before the load: opening scripts (an answer dialog, say) must not delay the title
    const ok = await runtime.load(stack);
    if (ok && opts.autosave !== false) autosave.saveNow(stack);
    return ok;
  }

  async function loadKey(key: FixtureName): Promise<void> {
    if (runtime.isBusy) {
      picker.setValue(current);
      return;
    }
    const seq = ++loadSeq;
    try {
      const stack = await loadFixture(key);
      if (seq !== loadSeq) return; // superseded while the fixture was importing
      if (!(await loadStack(stack))) {
        picker.setValue(current);
        return;
      }
      current = key;
      picker.setValue(key);
      history.replaceState(null, '', urlWithFixture(location.href, key));
    } catch (e) {
      console.error(e);
      picker.setValue(current);
      status.show(`Could not load stack: ${messageOf(e)}`);
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
      if (!(await loadStack(stack))) return;
      current = UNTITLED;
      picker.showUntitled();
      leaveFixtureLink();
    })();
  });

  /** A summoned, imported or shared stack loads like New Stack, then opens in Edit mode under its own name. */
  async function loadNamedInEdit(stack: Stack): Promise<void> {
    if (!(await loadStack(stack))) throw new Error('A script is still running. Try again when it finishes.');
    current = CUSTOM;
    picker.showCustom(stack.name);
    leaveFixtureLink();
    if (!editor.enter()) status.show('The stack is loaded. Switch to Edit when its opening scripts finish.');
  }

  const summonDialog = new SummonDialog({
    transport: transportFor,
    wake,
    onLoaded: loadNamedInEdit,
    onBusyChange: pending => {
      summoning = pending;
      updateToolbar();
    },
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
    onImported: loadNamedInEdit,
  });
  summonButton.addEventListener('click', () => {
    if (!runtime.isBusy) summonDialog.open();
  });
  settingsButton.addEventListener('click', () => settingsDialog.open());
  shareButton.addEventListener('click', () => {
    if (!runtime.isBusy && runtime.currentStack) shareDialog.open();
  });

  messageBox.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || runtime.isBusy || editor.mode === 'edit') return;
    e.preventDefault();
    const line = messageBox.value;
    messageBoxInput.submitted(line);
    // The input is disabled while busy, which drops focus; restore it with the text selected.
    void runtime.runMessageBox(line).then(() => {
      // The message box is a person action, so persist any change it made (sharing REQ-2.1).
      const s = runtime.currentStack;
      if (s) {
        leaveFixtureLink();
        autosave.save(s);
      }
      messageBox.focus();
      messageBox.select();
    });
  });

  /** Open a stack shared in the URL fragment: Browse, named, autosave OFF so the visitor's own save is kept. */
  async function openShared(encoded: string): Promise<void> {
    let stack: Stack;
    try {
      stack = await decodeStack(encoded);
    } catch {
      status.show('That shared link could not be opened; opening the sample stack.');
      void loadKey(DEFAULT_FIXTURE);
      return;
    }
    if (!(await loadStack(stack, { autosave: false }))) return;
    current = CUSTOM;
    picker.showCustom(stack.name);
    // Drop the fragment (and any query) so a reload falls through to the visitor's own autosave.
    history.replaceState(null, '', `${location.origin}${location.pathname}`);
  }

  toolbar.append(title, picker.el, newStackButton, summonButton, shareButton, settingsButton, toggle.el);
  root.replaceChildren(toolbar, editToolbarHost, workspace, statusEl, messageBoxInput.el);
  stage.observe();

  // Initial load (sharing REQ-2.2): share fragment, then ?stack=, then autosave, then the quiz.
  const initial = chooseInitialLoad(location, safeStorage);
  if (initial.corruptAutosave) status.show('Your saved stack could not be read; opening the sample stack.');
  switch (initial.load.source) {
    case 'share':
      void openShared(initial.load.encoded);
      break;
    case 'fixture':
      void loadKey(initial.load.key);
      break;
    case 'autosave': {
      const saved = initial.load.stack;
      void (async () => {
        if (await loadStack(saved, { autosave: false })) {
          current = CUSTOM;
          picker.showCustom(saved.name);
        }
      })();
      break;
    }
    case 'default':
      void loadKey(DEFAULT_FIXTURE);
      break;
  }

  // A share link pasted into an already-open tab only changes the fragment (a same-document
  // navigation), so boot() does not re-run; handle it here. Opening in a fresh tab uses the load above.
  addEventListener('hashchange', () => {
    const encoded = new URLSearchParams(location.hash.replace(/^#/, '')).get('s');
    if (encoded && encoded.trim() !== '' && !runtime.isBusy) void openShared(encoded);
  });
}

const root = document.getElementById('app');
if (root) boot(root);
