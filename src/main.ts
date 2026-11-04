// NecroCard entry point: browse and edit modes, stack picker, New Stack, message box.
import './ui/variables.css';
import './ui/chrome.css';
import './ui/browse/browse.css';
import './ui/edit/edit.css';
import './ui/script-editor/script-editor.css';
import './ui/summon/summon.css';
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
import { createAgentClient } from './summon/agentClient.js';
import { createDirectTransport, KEY_STORAGE, testDirectKey } from './summon/directTransport.js';
import { createServerTransport } from './summon/serverTransport.js';
import type { Transport } from './summon/transport.js';
import { createWakeState } from './summon/wake.js';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The key is read from local storage only, at call time (summon REQ-4.3). */
function readStoredKey(): string | null {
  try {
    const key = localStorage.getItem(KEY_STORAGE);
    return key && key.trim() !== '' ? key : null;
  } catch {
    return null; // storage disabled: the server path still works
  }
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

  /** Toolbar controls are disabled while scripts run or a summon is pending. */
  let summoning = false;
  const updateToolbar = () => {
    const busy = runtime.isBusy || summoning;
    picker.setDisabled(busy);
    newStackButton.disabled = busy;
    summonButton.disabled = busy;
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
  });

  const editor = new EditController({
    stage, runtime, status, messageBox,
    inspectorHost: workspace,
    toolbarHost: editToolbarHost,
    onModeChange: mode => toggle.set(mode),
    agent: createAgentClient(transportFor),
  });

  /** Bumped by every load, so a slow fixture import cannot replace a newer New Stack or Summon. */
  let loadSeq = 0;

  /** Load any stack exactly like a fixture: Browse mode, history cleared (REQ-1.4). */
  async function loadStack(stack: Stack): Promise<boolean> {
    if (runtime.isBusy) return false;
    loadSeq++;
    editor.reset();
    return runtime.load(stack);
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
      const url = new URL(location.href);
      url.searchParams.delete('stack');
      history.replaceState(null, '', url.toString());
    })();
  });

  /** A summoned stack loads like New Stack, then opens in Edit mode under its own name (summon REQ-8.3). */
  async function loadSummoned(stack: Stack): Promise<void> {
    if (!(await loadStack(stack))) throw new Error('A script is still running. Try again when it finishes.');
    current = CUSTOM;
    picker.showCustom(stack.name);
    const url = new URL(location.href);
    url.searchParams.delete('stack');
    history.replaceState(null, '', url.toString());
    if (!editor.enter()) status.show('The stack is loaded. Switch to Edit when its opening scripts finish.');
  }

  const summonDialog = new SummonDialog({
    transport: transportFor,
    wake,
    onLoaded: loadSummoned,
    onBusyChange: pending => {
      summoning = pending;
      updateToolbar();
    },
  });
  const settingsDialog = new SettingsDialog({
    storage: keyStorage,
    testKey: (key, signal) => testDirectKey(key, signal),
  });
  summonButton.addEventListener('click', () => {
    if (!runtime.isBusy) summonDialog.open();
  });
  settingsButton.addEventListener('click', () => settingsDialog.open());

  messageBox.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || runtime.isBusy || editor.mode === 'edit') return;
    e.preventDefault();
    const line = messageBox.value;
    messageBoxInput.submitted(line);
    // The input is disabled while busy, which drops focus; restore it with the text selected.
    void runtime.runMessageBox(line).then(() => {
      messageBox.focus();
      messageBox.select();
    });
  });

  toolbar.append(title, picker.el, newStackButton, summonButton, settingsButton, toggle.el);
  root.replaceChildren(toolbar, editToolbarHost, workspace, statusEl, messageBoxInput.el);
  stage.observe();
  void loadKey(fixtureFromSearch(location.search));
}

const root = document.getElementById('app');
if (root) boot(root);
