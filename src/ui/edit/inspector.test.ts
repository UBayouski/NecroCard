// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Inspector, type InspectorActions, type InspectorView } from './inspector.js';
import { findError } from '../script-editor/errors.js';
import { background, button, field, image, makeStack } from '../browse/testStacks.js';

function actions(): InspectorActions & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const rec = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); };
  return {
    calls,
    setRect: vi.fn(rec('setRect')), setProp: vi.fn(rec('setProp')), setScript: vi.fn(rec('setScript')),
    importImage: vi.fn(rec('importImage')), renameCard: vi.fn(rec('renameCard')), renameStack: vi.fn(rec('renameStack')),
  };
}

function sample() {
  const btn = button('Go', { rect: { x: 10, y: 20, w: 30, h: 40 }, label: 'Go on', script: 'on mouseUp\nend mouseUp' });
  const twin = button('go');
  const note = field('Note', { text: 'hi', lockText: true, style: 'scrolling' });
  const pic = image('Bat', { src: 'data:image/png;base64,' + 'A'.repeat(100) });
  const asset = image('Moon', { src: 'asset-moon' });
  const stack = makeStack({
    name: 'Haunt',
    backgrounds: [background('Main', [], '-- bg')],
    cards: [{ name: 'One', objects: [btn, twin, note, pic, asset] }, { name: 'one' }],
  });
  return { stack, btn, twin, note, pic, asset };
}

const view = (stack: ReturnType<typeof sample>['stack'], obj?: { id: string }): InspectorView =>
  obj ? { kind: 'object', stack, cardIndex: 0, obj: stack.cards[0].objects.find(o => o.id === obj.id)! }
    : { kind: 'card', stack, cardIndex: 0 };

const byLabel = (root: HTMLElement, text: string) => {
  const label = Array.from(root.querySelectorAll('label')).find(l => l.textContent === text);
  if (!label) throw new Error(`no label ${text}`);
  return root.querySelector<HTMLInputElement>(`#${label.htmlFor}`)!;
};

const change = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value?: string) => {
  if (value !== undefined) el.value = value;
  el.dispatchEvent(new Event('change'));
};

afterEach(() => { document.body.replaceChildren(); });

describe('Inspector — object view', () => {
  it('shows the button controls with model values and a heading', () => {
    const { stack, btn } = sample();
    const insp = new Inspector(actions());
    insp.show(view(stack, btn));
    const el = insp.el;
    expect(el.getAttribute('aria-label')).toBe('Inspector');
    expect(el.querySelector('h2')!.textContent).toBe('Button "Go"');
    expect(byLabel(el, 'Name').value).toBe('Go');
    expect(['X', 'Y', 'W', 'H'].map(k => byLabel(el, k).value)).toEqual(['10', '20', '30', '40']);
    expect(byLabel(el, 'Visible').checked).toBe(true);
    expect(byLabel(el, 'Style').value).toBe('rect');
    expect(byLabel(el, 'Label').value).toBe('Go on');
    expect(byLabel(el, 'Auto hilite').checked).toBe(true);
    expect(byLabel(el, 'Script').value).toBe('on mouseUp\nend mouseUp');
  });

  it('every control has a visible label pointing at it', () => {
    const { stack, note } = sample();
    const insp = new Inspector(actions());
    insp.show(view(stack, note));
    for (const input of insp.el.querySelectorAll('input, textarea, select')) {
      expect(insp.el.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    }
    expect(byLabel(insp.el, 'Text').tagName).toBe('TEXTAREA');
    expect(byLabel(insp.el, 'Lock text').checked).toBe(true);
    expect(byLabel(insp.el, 'Style').value).toBe('scrolling');
  });

  it('commits only on change and only when the value differs', () => {
    const { stack, btn } = sample();
    const a = actions();
    const insp = new Inspector(a);
    insp.show(view(stack, btn));
    change(byLabel(insp.el, 'Label'));
    expect(a.calls).toEqual([]);
    change(byLabel(insp.el, 'Label'), 'Flee');
    change(byLabel(insp.el, 'Visible'), undefined); // unchanged checkbox
    const vis = byLabel(insp.el, 'Visible');
    vis.checked = false;
    change(vis);
    change(byLabel(insp.el, 'Style'), 'transparent');
    change(byLabel(insp.el, 'Script'), 'on mouseUp\n  go next\nend mouseUp');
    expect(a.calls).toEqual([
      ['setProp', btn.id, 'label', 'Flee'],
      ['setProp', btn.id, 'visible', false],
      ['setProp', btn.id, 'style', 'transparent'],
      ['setScript', { kind: 'object', cardId: stack.cards[0].id, objectId: btn.id }, 'on mouseUp\n  go next\nend mouseUp'],
    ]);
  });

  it('rect inputs accept whole numbers only; invalid input reverts with a message', () => {
    const { stack, btn } = sample();
    const a = actions();
    const insp = new Inspector(a);
    insp.show(view(stack, btn));
    const x = byLabel(insp.el, 'X');
    change(x, '12.5');
    expect(x.value).toBe('10');
    expect(insp.el.querySelector(`#${x.getAttribute('aria-describedby')}`)!.textContent).toBe('Enter a whole number');
    change(x, ' -7 ');
    expect(a.calls).toEqual([['setRect', btn.id, { x: -7, y: 20, w: 30, h: 40 }]]);
  });

  it('re-syncs from the model but never overwrites the focused control', () => {
    const { stack, btn } = sample();
    const insp = new Inspector(actions());
    document.body.append(insp.el);
    insp.show(view(stack, btn));
    const label = byLabel(insp.el, 'Label');
    label.focus();
    label.value = 'typing…';
    btn.label = 'from model';
    btn.rect = { x: 99, y: 20, w: 30, h: 40 };
    insp.show(view(stack, btn));
    expect(label.value).toBe('typing…');
    expect(byLabel(insp.el, 'X').value).toBe('99'); // clamped/updated value shown after commit
  });

  it('flush commits pending input', () => {
    const { stack, btn } = sample();
    const a = actions();
    const insp = new Inspector(a);
    insp.show(view(stack, btn));
    byLabel(insp.el, 'Name').value = 'Typed';
    byLabel(insp.el, 'Script').value = '-- typed';
    insp.flush();
    expect(a.calls).toEqual([
      ['setProp', btn.id, 'name', 'Typed'],
      ['setScript', { kind: 'object', cardId: stack.cards[0].id, objectId: btn.id }, '-- typed'],
    ]);
  });

  it('warns about duplicate object names (case-insensitive, same type)', () => {
    const { stack, btn, note } = sample();
    const insp = new Inspector(actions());
    insp.show(view(stack, btn));
    expect(insp.el.textContent).toContain('Another button on this card has this name; scripts will find the first one.');
    insp.show(view(stack, note));
    expect(insp.el.textContent).not.toContain('Another');
  });

  it('images: data URLs are read-only and truncated; asset ids editable; Import… asks the editor', () => {
    const { stack, pic, asset } = sample();
    const a = actions();
    const insp = new Inspector(a);
    insp.show(view(stack, pic));
    const src = byLabel(insp.el, 'Source');
    expect(src.readOnly).toBe(true);
    expect(src.value).toMatch(/^data:image\/png;base64,A+… \(122 characters\)$/);
    change(src, 'hacked');
    insp.el.querySelector<HTMLButtonElement>('button')!.click();
    expect(a.calls).toEqual([['importImage', pic.id]]);
    insp.show(view(stack, asset));
    change(byLabel(insp.el, 'Source'), 'asset-sun');
    expect(a.calls[1]).toEqual(['setProp', asset.id, 'src', 'asset-sun']);
  });

  it('shows the parse result under the script, 300 ms after typing', () => {
    vi.useFakeTimers();
    try {
      const { stack, btn } = sample();
      const insp = new Inspector(actions());
      insp.show(view(stack, btn));
      const status = () => insp.el.querySelector('.code-editor [role="status"]')!.textContent;
      expect(status()).toBe('No errors');
      const ta = byLabel(insp.el, 'Script');
      ta.value = 'on mouseUp\n  go nowhere fast\nend mouseUp';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(300);
      expect(status()).toMatch(/^Line 2: /);
      expect(findError('')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Inspector — card view', () => {
  it('shows card, background and stack sections; stack name editable, background name read-only', () => {
    const { stack } = sample();
    const a = actions();
    const insp = new Inspector(a);
    insp.show(view(stack));
    const el = insp.el;
    expect(Array.from(el.querySelectorAll('h2, h3')).map(h => h.textContent)).toEqual(['Card', 'Background', 'Stack']);
    expect(byLabel(el, 'Name').value).toBe('One');
    expect(el.textContent).toContain('Card 1 of 2');
    expect(el.textContent).toContain('Main');
    expect(byLabel(el, 'Background script').value).toBe('-- bg');
    expect(byLabel(el, 'Stack name').value).toBe('Haunt');
    change(byLabel(el, 'Stack name'), 'Renamed');
    change(byLabel(el, 'Name'), 'First');
    change(byLabel(el, 'Card script'), '-- card');
    change(byLabel(el, 'Background script'), '-- bg2');
    change(byLabel(el, 'Stack script'), '-- stack');
    expect(a.calls).toEqual([
      ['renameStack', 'Renamed'],
      ['renameCard', stack.cards[0].id, 'First'],
      ['setScript', { kind: 'card', cardId: stack.cards[0].id }, '-- card'],
      ['setScript', { kind: 'background', backgroundId: stack.backgrounds[0].id }, '-- bg2'],
      ['setScript', { kind: 'stack' }, '-- stack'],
    ]);
  });

  it('warns about duplicate card names', () => {
    const { stack } = sample();
    const insp = new Inspector(actions());
    insp.show(view(stack));
    expect(insp.el.textContent).toContain('Another card has this name; go to card "One" finds the first one.');
  });

  it('rebuilds when the subject changes and focusScript focuses the object script', () => {
    const { stack, btn } = sample();
    const insp = new Inspector(actions());
    document.body.append(insp.el);
    insp.show(view(stack));
    insp.show(view(stack, btn));
    insp.focusScript();
    expect(document.activeElement).toBe(byLabel(insp.el, 'Script'));
  });
});
