import type { AgentClient, ScriptContext } from '../../summon/agentClient.js';
import { CodeEditor } from '../script-editor/codeEditor.js';
import { DiffView } from '../script-editor/diffView.js';
import { ExpandDialog } from '../script-editor/expandDialog.js';

/**
 * The script editing surface in the inspector. Same interface as edit-mode's plain textarea, so
 * the inspector's commit rules are unchanged; `destroy` releases the editor (and closes Expand).
 */
export interface ScriptEditorSlot {
  readonly el: HTMLElement;
  set(source: string): void;
  onCommit(cb: (source: string) => void): void;
  /** Commit pending text if it differs from the last value set. */
  commit(): void;
  focus(): void;
  hasFocus(): boolean;
  destroy(): void;
}

export interface ScriptSlotDeps {
  agent: AgentClient;
  /** What the agent is told about this script's owner (computed when a button is pressed). */
  context(): ScriptContext;
  status: { show(message: string): void; clear(): void };
}

type State = 'editing' | 'pending' | 'diff';

let seq = 0;
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** Script editor slot: highlighted editor, Explain / Fix through the agent, diff view, Expand. */
export function createScriptSlot(label: string, deps: ScriptSlotDeps): ScriptEditorSlot {
  const id = `script-${++seq}`;
  const el = document.createElement('div');
  el.className = 'inspector-row inspector-row--script';
  const lab = document.createElement('label');
  lab.htmlFor = id;
  lab.textContent = label;

  const editor = new CodeEditor({ id });
  // Everything Expand moves: the editor, its action row, the explanation and any open diff.
  const work = document.createElement('div');
  work.className = 'script-work';
  const button = (text: string, run: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chrome-button';
    b.textContent = text;
    b.addEventListener('click', run);
    return b;
  };
  const explainBtn = button('Explain', () => explain());
  const fixBtn = button('Fix', () => fix());
  const cancelBtn = button('Cancel', () => cancelPending());
  cancelBtn.hidden = true;
  const actions = document.createElement('div');
  actions.className = 'script-actions';
  actions.append(explainBtn, fixBtn, cancelBtn);
  const explanation = document.createElement('section');
  explanation.className = 'script-explanation';
  explanation.setAttribute('aria-label', 'Explanation');
  explanation.hidden = true;
  const explanationText = document.createElement('p');
  explanation.append(explanationText, button('Close', () => { explanation.hidden = true; editor.textarea.focus(); }));
  const diffHost = document.createElement('div');
  work.append(editor.el, actions, explanation, diffHost);

  const expandBtn = button('Expand', () => dialog.open());
  expandBtn.classList.add('script-expand');
  const dialog = new ExpandDialog(work, {
    // Name the owner, e.g. `Script of button "BeginButton"` (the slot label alone is just "Script").
    title: () => {
      const { owner } = deps.context();
      return `Script of ${owner.type} "${owner.name}"`;
    },
    onOpen: () => {
      editor.setRows(24);
      expandBtn.textContent = 'Expanded';
      expandBtn.disabled = true;
      editor.textarea.focus();
    },
    onClose: () => {
      editor.setRows(10);
      expandBtn.textContent = 'Expand';
      expandBtn.disabled = false;
      if (el.isConnected) expandBtn.focus();
    },
  });
  el.append(lab, work, expandBtn);

  let last = '';
  let cb: (source: string) => void = () => {};
  let state: State = 'editing';
  let controller: AbortController | null = null;
  let diff: DiffView | null = null;

  const commit = () => {
    if (editor.value === last) return;
    last = editor.value;
    cb(editor.value);
  };
  editor.textarea.addEventListener('change', commit);

  const setPending = (on: boolean) => {
    state = on ? 'pending' : 'editing';
    editor.setReadOnly(on);
    editor.setStatus(on ? 'Asking Summon…' : null);
    explainBtn.disabled = on;
    fixBtn.disabled = on;
    cancelBtn.hidden = !on;
  };

  /** Run one agent request; `done` receives the result unless the request was cancelled. */
  const request = (run: (signal: AbortSignal) => Promise<string>, done: (result: string) => void) => {
    if (state !== 'editing') return;
    const c = new AbortController();
    controller = c;
    setPending(true);
    deps.status.clear();
    run(c.signal).then(
      result => {
        if (controller !== c || c.signal.aborted) return;
        controller = null;
        setPending(false);
        done(result);
      },
      e => {
        if (controller !== c || c.signal.aborted) return;
        controller = null;
        setPending(false);
        if (!isAbort(e)) deps.status.show(messageOf(e));
      },
    );
  };

  const explain = () => request(
    signal => deps.agent.explain(editor.value, deps.context(), signal),
    text => {
      explanationText.textContent = text;
      explanation.hidden = false;
    },
  );

  const fix = () => {
    const source = editor.value;
    editor.checkNow();
    const error = editor.error?.message ?? null;
    request(signal => deps.agent.fix(source, error, deps.context(), signal), proposal => openDiff(source, proposal));
  };

  const cancelPending = () => {
    if (state !== 'pending' || !controller) return;
    controller.abort();
    controller = null;
    setPending(false);
    editor.textarea.focus();
  };

  const closeDiff = () => {
    diff?.el.remove();
    diff = null;
    editor.el.hidden = false;
    actions.hidden = false;
    state = 'editing';
    editor.setReadOnly(false);
  };

  const openDiff = (source: string, proposal: string) => {
    explanation.hidden = true;
    diff = new DiffView(source, proposal, {
      apply: () => {
        closeDiff();
        editor.set(proposal);
        commit(); // one setScript command
        editor.textarea.focus();
      },
      cancel: () => { closeDiff(); editor.textarea.focus(); },
    });
    state = 'diff';
    editor.setReadOnly(true);
    editor.el.hidden = true;
    actions.hidden = true;
    diffHost.append(diff.el);
    diff.heading.focus();
  };

  return {
    el,
    set: source => {
      // An external change (undo, another commit) wins over a pending request or an open diff.
      if (source !== editor.value) {
        if (state === 'pending') cancelPending();
        if (state === 'diff') closeDiff();
        editor.set(source);
      }
      last = source;
    },
    onCommit: f => { cb = f; },
    commit,
    focus: () => { editor.textarea.focus(); editor.textarea.scrollIntoView?.({ block: 'nearest' }); },
    hasFocus: () => work.contains(work.ownerDocument.activeElement),
    destroy: () => {
      dialog.close();
      controller?.abort();
      controller = null;
      editor.destroy();
    },
  };
}
