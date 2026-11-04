// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeleteControl } from './libraryControls.js';

afterEach(() => {
  document.querySelectorAll('dialog').forEach(d => d.remove());
});

const dialog = () => document.querySelector('dialog.library-delete');

describe('createDeleteControl', () => {
  it('starts disabled and toggles with setEnabled', () => {
    const control = createDeleteControl({ onConfirm: () => {} });
    expect(control.button.disabled).toBe(true);
    control.setEnabled(true);
    expect(control.button.disabled).toBe(false);
    control.setEnabled(false);
    expect(control.button.disabled).toBe(true);
  });

  it('a disabled button does not open the confirm', () => {
    const control = createDeleteControl({ onConfirm: () => {} });
    control.button.click();
    expect(dialog()).toBeNull();
  });

  it('opens a confirm naming the stack; Delete confirms, Cancel does not', () => {
    const onConfirm = vi.fn();
    const control = createDeleteControl({ onConfirm });
    control.setEnabled(true);
    control.setName('Ghost Quiz');

    control.button.click();
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain('Delete "Ghost Quiz"?');

    // Cancel closes without confirming.
    const [cancel, confirm] = Array.from(dialog()!.querySelectorAll('button'));
    expect(cancel.textContent).toBe('Cancel');
    expect(confirm.textContent).toBe('Delete');
    cancel.click();
    expect(dialog()).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();

    // Reopen and confirm.
    control.button.click();
    Array.from(dialog()!.querySelectorAll('button'))[1].click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it('shows the current name each time it opens', () => {
    const control = createDeleteControl({ onConfirm: () => {} });
    control.setEnabled(true);
    control.setName('First');
    control.button.click();
    expect(dialog()!.textContent).toContain('"First"');
    dialog()!.querySelector('button')!.click(); // Cancel
    control.setName('Second');
    control.button.click();
    expect(dialog()!.textContent).toContain('"Second"');
  });
});
