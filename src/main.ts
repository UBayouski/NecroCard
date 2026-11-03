// NecroCard entry point: browse and edit modes, stack picker, New Stack, message box.
import './ui/variables.css';
import './ui/chrome.css';
import './ui/browse/browse.css';
import './ui/edit/edit.css';
import { loadFixture, type FixtureName } from './model/fixtures.js';
import type { Stack } from './model/types.js';
import { CardStage } from './ui/browse/stage.js';
import { BrowseRuntime, type StatusLine } from './ui/browse/runtime.js';
import { createStackPicker, fixtureFromSearch, UNTITLED, urlWithFixture } from './ui/browse/stackPicker.js';
import { EditController } from './ui/edit/editor.js';
import { createModeToggle } from './ui/edit/modeToggle.js';
import { createNewStack } from './ui/edit/newStack.js';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

function boot(root: HTMLElement): void {
  root.className = 'app';

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

  const messageBox = document.createElement('input');
  messageBox.type = 'text';
  messageBox.className = 'message-box font-script';
  messageBox.setAttribute('aria-label', 'Message box');
  messageBox.spellcheck = false;
  messageBox.autocomplete = 'off';

  let current: FixtureName | typeof UNTITLED = fixtureFromSearch(location.search);
  const picker = createStackPicker(key => { void loadKey(key); });
  picker.setValue(current);

  const newStackButton = document.createElement('button');
  newStackButton.type = 'button';
  newStackButton.className = 'chrome-button';
  newStackButton.textContent = 'New Stack';

  // `editor` is declared below; these callbacks only run after it exists.
  const toggle = createModeToggle(mode => {
    if (mode === 'edit') editor.enter();
    else editor.exit();
  });

  const runtime = new BrowseRuntime(stage, status, {
    dialogInert: () => [messageBox, toolbar],
    onBusyChange: busy => {
      picker.setDisabled(busy);
      newStackButton.disabled = busy;
      toggle.setDisabled(busy);
      messageBox.disabled = busy || editor.mode === 'edit';
    },
    onLoad: () => editor.reset(),
  });

  const editor = new EditController({
    stage, runtime, status, messageBox,
    inspectorHost: workspace,
    toolbarHost: editToolbarHost,
    onModeChange: mode => toggle.set(mode),
  });

  /** Load any stack exactly like a fixture: Browse mode, history cleared (REQ-1.4). */
  async function loadStack(stack: Stack): Promise<boolean> {
    if (runtime.isBusy) return false;
    editor.reset();
    return runtime.load(stack);
  }

  async function loadKey(key: FixtureName): Promise<void> {
    if (runtime.isBusy) {
      picker.setValue(current);
      return;
    }
    try {
      const stack = await loadFixture(key);
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

  messageBox.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || runtime.isBusy || editor.mode === 'edit') return;
    e.preventDefault();
    // The input is disabled while busy, which drops focus; restore it with the text selected.
    void runtime.runMessageBox(messageBox.value).then(() => {
      messageBox.focus();
      messageBox.select();
    });
  });

  toolbar.append(title, picker.el, newStackButton, toggle.el);
  root.replaceChildren(toolbar, editToolbarHost, workspace, statusEl, messageBox);
  stage.observe();
  void loadKey(fixtureFromSearch(location.search));
}

const root = document.getElementById('app');
if (root) boot(root);
