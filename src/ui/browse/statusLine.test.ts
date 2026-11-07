// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { QUOTA_MESSAGE } from './persist.js';
import { createStatusLine, STATUS_INFO_CLASS } from './statusLine.js';

describe('status line tones', () => {
  it('shows the share notice with the info style', () => {
    const status = createStatusLine();
    status.show('Opened from a shared link', 'info');
    expect(status.el.textContent).toBe('Opened from a shared link');
    expect(status.el.classList.contains('status-line')).toBe(true);
    expect(status.el.classList.contains(STATUS_INFO_CLASS)).toBe(true);
  });

  it('keeps the error style for the library-full message (the default tone)', () => {
    const status = createStatusLine();
    status.show(QUOTA_MESSAGE);
    expect(status.el.textContent).toBe(QUOTA_MESSAGE);
    expect(status.el.classList.contains(STATUS_INFO_CLASS)).toBe(false);
  });

  it('an error after an info message drops the info style, and clear resets both', () => {
    const status = createStatusLine();
    status.show('Opened from a shared link', 'info');
    status.show(QUOTA_MESSAGE);
    expect(status.el.classList.contains(STATUS_INFO_CLASS)).toBe(false);
    status.show('Opened from a shared link', 'info');
    status.clear();
    expect(status.el.textContent).toBe('');
    expect(status.el.classList.contains(STATUS_INFO_CLASS)).toBe(false);
  });

  it('keeps role="alert" so screen readers still announce it', () => {
    expect(createStatusLine().el.getAttribute('role')).toBe('alert');
  });
});
