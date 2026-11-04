import { collectErrors, expect, test, UNCONFIGURED_MESSAGE, type Page } from './apiMock.js';

const surface = (page: Page) => page.getByRole('application', { name: 'HyperCard stack' });
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const scriptBox = (page: Page) => inspector(page).getByLabel('Script', { exact: true });
const scriptStatus = (page: Page) => inspector(page).locator('.code-editor [role="status"]');

/** Load the quiz, switch to Edit, and open BeginButton's script by double-clicking it. */
async function openBeginButtonScript(page: Page) {
  await page.goto('/?stack=quiz');
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Title');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await page.getByRole('radio', { name: 'Edit', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-mode', 'edit');
  // The edit overlay covers the card, so the double-click lands on it at the button's position.
  await surface(page).locator('[data-object-name="BeginButton"]').dblclick({ force: true });
  await expect(inspector(page).getByRole('heading', { level: 2 })).toHaveText('Button "BeginButton"');
  await expect(scriptBox(page)).toBeFocused();
}

test('broken handler shows an inline error; fixing it and clicking in Browse goes to Q1', async ({ page }) => {
  const errors = collectErrors(page);
  await openBeginButtonScript(page);

  await scriptBox(page).fill('on mouseUp\n  go to card "Q1"\nend mouseDown');
  await expect(scriptStatus(page)).toHaveText(/^Line 3: /, { timeout: 1000 });
  await expect(scriptBox(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(inspector(page).locator('.code-gutter-line--error')).toHaveText('!3');
  await expect(inspector(page).locator('.script-line--error')).toHaveAttribute('data-line', '3');
  // Highlighting comes from the tokenizer.
  await expect(inspector(page).locator('.code-editor-mirror .tok-handler').first()).toHaveText('mouseUp');
  await expect(inspector(page).locator('.code-editor-mirror .tok-string')).toHaveText('"Q1"');

  await scriptBox(page).fill('on mouseUp\n  go to card "Q1"\nend mouseUp');
  await expect(scriptStatus(page)).toHaveText('No errors', { timeout: 1000 });
  await expect(scriptBox(page)).not.toHaveAttribute('aria-invalid', 'true');

  await page.getByRole('radio', { name: 'Browse', exact: true }).click();
  await surface(page).getByRole('button', { name: 'Enter if you dare...', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Q1');
  expect(errors).toEqual([]);
});

test('Fix against an unconfigured server reports its message in the status line', async ({ page }) => {
  const errors = collectErrors(page);
  await openBeginButtonScript(page);
  await inspector(page).getByRole('button', { name: 'Fix', exact: true }).first().click();
  await expect(page.getByRole('alert')).toHaveText(UNCONFIGURED_MESSAGE);
  await expect(scriptBox(page)).not.toHaveAttribute('readonly', '');
  expect(errors).toEqual([]);
});

test('Chrome: Ctrl+] then Ctrl+Z leaves a caret, not a selection (finding 2)', async ({ page }) => {
  await openBeginButtonScript(page);
  const box = scriptBox(page);
  await box.fill('on mouseUp\n  go next\nend mouseUp');
  // Caret inside "go next" on line 2.
  await box.evaluate((ta: HTMLTextAreaElement) => { ta.setSelectionRange(16, 16); });
  await page.keyboard.press('Control+BracketRight');
  await expect(box).toHaveValue('on mouseUp\n    go next\nend mouseUp');
  const afterIndent = await box.evaluate((ta: HTMLTextAreaElement) => [ta.selectionStart, ta.selectionEnd]);
  expect(afterIndent).toEqual([18, 18]);
  await page.keyboard.press('Control+z');
  await expect(box).toHaveValue('on mouseUp\n  go next\nend mouseUp');
  const [start, end] = await box.evaluate((ta: HTMLTextAreaElement) => [ta.selectionStart, ta.selectionEnd]);
  expect(start).toBe(end); // a caret, not the whole line selected
});

test('Chrome: the selection background is translucent so highlighted text shows (finding 1)', async ({ page }) => {
  await openBeginButtonScript(page);
  const alpha = (selector: string) => page.evaluate(sel => {
    const el = document.querySelector(sel)!;
    const bg = getComputedStyle(el, '::selection').backgroundColor;
    const m = bg.match(/rgba?\(([^)]+)\)/);
    const parts = m ? m[1].split(',').map(s => Number(s.trim())) : [];
    return parts.length === 4 ? parts[3] : 1;
  }, selector);
  const editorAlpha = await alpha('.code-editor-input');
  const boxAlpha = await alpha('.message-box');
  expect(editorAlpha).toBeGreaterThan(0);
  expect(editorAlpha).toBeLessThan(1);
  expect(boxAlpha).toBeGreaterThan(0);
  expect(boxAlpha).toBeLessThan(1);
});
