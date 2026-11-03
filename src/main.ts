// NecroCard entry point: browse mode with a stack picker and a message box.
import './ui/variables.css';
import './ui/chrome.css';
import './ui/browse/browse.css';
import { loadFixture, type FixtureName } from './model/fixtures.js';
import { CardStage } from './ui/browse/stage.js';
import { BrowseRuntime, type StatusLine } from './ui/browse/runtime.js';
import { createStackPicker, fixtureFromSearch, urlWithFixture } from './ui/browse/stackPicker.js';

function boot(root: HTMLElement): void {
  root.className = 'app';

  const toolbar = document.createElement('header');
  toolbar.className = 'chrome-toolbar';
  const title = document.createElement('h1');
  title.className = 'chrome-title';
  title.textContent = 'NecroCard';

  const stage = new CardStage();

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

  let current: FixtureName = fixtureFromSearch(location.search);
  const picker = createStackPicker(key => { void load(key); });
  picker.setValue(current);

  const runtime = new BrowseRuntime(stage, status, {
    dialogInert: () => [messageBox, toolbar],
    onBusyChange: busy => {
      picker.setDisabled(busy);
      messageBox.disabled = busy;
    },
  });

  async function load(key: FixtureName): Promise<void> {
    if (runtime.isBusy) {
      picker.setValue(current);
      return;
    }
    try {
      const stack = await loadFixture(key);
      if (!(await runtime.load(stack))) {
        picker.setValue(current);
        return;
      }
      current = key;
      history.replaceState(null, '', urlWithFixture(location.href, key));
    } catch (e) {
      console.error(e);
      picker.setValue(current);
      status.show(`Could not load stack: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  messageBox.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || runtime.isBusy) return;
    e.preventDefault();
    // The input is disabled while busy, which drops focus; restore it with the text selected.
    void runtime.runMessageBox(messageBox.value).then(() => {
      messageBox.focus();
      messageBox.select();
    });
  });

  toolbar.append(title, picker.el);
  root.replaceChildren(toolbar, stage.viewport, statusEl, messageBox);
  stage.observe();
  void load(current);
}

const root = document.getElementById('app');
if (root) boot(root);
