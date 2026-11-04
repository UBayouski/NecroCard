import { collectErrors, expect, mockUnconfiguredServer, test, UNCONFIGURED_MESSAGE, type Page } from './apiMock.js';

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

// Chrome's textarea selection painter draws bands of the wrong width on some rows when the textarea paints scroll bars:
// a long row gets a band a few characters wide and the short row after it a long band. The editor textarea paints no
// scroll bars (scrollbar-width: none) to avoid it. This checks the painted pixels.
const SELECTION_HANDLER = [
  'on openCard',
  '  put field "Score" into it',
  '  if it is "Score: 2" then',
  '    put "Master Ghost Hunter!" into field "Summary"',
  '  else if it is "Score: 1" then',
  '    put "Not bad, apprentice ghost!" into field "Summary"',
  '  else',
  '    put "Banshees got the best of you." into field "Summary"',
  '  end if',
  'end openCard',
].join('\n');

test('Chrome: Select All paints the selection band to each row\'s own width', async ({ playwright }) => {
  // The misdrawn bands only appear when the textarea has real scroll bars, and Playwright's headless Chromium starts
  // with --hide-scrollbars. A launch flag cannot be set per test, so this test launches its own browser without it.
  const browser = await playwright.chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await mockUnconfiguredServer(page);
    await selectAllAndSample(page);
  } finally {
    await browser.close();
  }
});

async function selectAllAndSample(page: Page) {
  await openBeginButtonScript(page);
  const box = scriptBox(page);
  await box.fill(SELECTION_HANDLER);
  await expect(scriptStatus(page)).toHaveText('No errors', { timeout: 1000 });
  await page.evaluate(() => document.fonts.ready);
  await box.focus();
  await page.keyboard.press('Control+A');
  expect(await box.evaluate((ta: HTMLTextAreaElement) => [ta.selectionStart, ta.selectionEnd]))
    .toEqual([0, SELECTION_HANDLER.length]);

  // Where to look, in CSS pixels relative to .code-editor-body: inside the row-6 string literal, and the same x on
  // row 7, which is past the end of "  else".
  const body = page.locator('.code-editor-body');
  const spot = await page.evaluate(() => {
    const bodyEl = document.querySelector('.code-editor-body')!;
    const b = bodyEl.getBoundingClientRect();
    const str = [...document.querySelectorAll('.code-editor-mirror .tok-string')]
      .find(e => e.textContent === '"Not bad, apprentice ghost!"')!;
    const r = str.getBoundingClientRect();
    const charW = r.width / str.textContent!.length;
    const lineH = parseFloat(getComputedStyle(document.querySelector('.code-editor-input')!).lineHeight);
    return { x0: r.left - b.left + charW, x1: r.left - b.left + 3 * charW, row6: r.top - b.top + lineH / 2, lineH, bodyW: b.width };
  });
  const elseEnd = await page.evaluate(() => {
    const ta = document.querySelector('.code-editor-input')!;
    const ctx = document.createElement('canvas').getContext('2d')!;
    const cs = getComputedStyle(ta);
    ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
    return parseFloat(cs.paddingLeft) + ctx.measureText('  else ').width; // text plus the painted newline
  });
  const editorLeft = await page.evaluate(() =>
    document.querySelector('.code-editor-input')!.getBoundingClientRect().left
    - document.querySelector('.code-editor-body')!.getBoundingClientRect().left);
  expect(spot.x0).toBeGreaterThan(editorLeft + elseEnd); // the row-7 sample really is right of its text

  const png = await body.screenshot({ animations: 'disabled' });
  const pixels = await page.evaluate(async ({ data, spot }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const scale = img.naturalWidth / spot.bodyW;
    /** Pixels of a 3-pixel-tall strip across [x0, x1] on the row centred at y. */
    const strip = (y: number) => {
      const x = Math.round(spot.x0 * scale), w = Math.max(1, Math.round((spot.x1 - spot.x0) * scale));
      const d = ctx.getImageData(x, Math.round(y * scale) - 1, w, 3).data;
      const out: [number, number, number][] = [];
      for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2]]);
      return out;
    };
    return { row6: strip(spot.row6), row7: strip(spot.row6 + spot.lineH) };
  }, { data: png.toString('base64'), spot });

  const white = ([r, g, b]: [number, number, number]) => r >= 250 && g >= 250 && b >= 250;
  // The selection tint is a light blue: clearly bluer than it is red, and not dark like a glyph stroke.
  const tint = ([r, , b]: [number, number, number]) => b - r >= 8 && r >= 150 && !(r >= 250 && b >= 250);

  // Row 7 ("  else"): everything right of its text stays white.
  expect(pixels.row7.filter(p => !white(p))).toEqual([]);
  // Row 6: inside the string literal the band is painted: no white gaps, and the background shows the tint.
  expect(pixels.row6.filter(white)).toEqual([]);
  expect(pixels.row6.filter(tint).length).toBeGreaterThan(pixels.row6.length / 4);
}
