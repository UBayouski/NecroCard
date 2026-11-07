// retro-skin end to end. Task 3 adds the fixture-fit check; Task 7 adds the font-load check and the reference shot.
import { expect, test, type Page } from './apiMock.js';

const surface = (page: Page) => page.getByRole('application', { name: 'HyperCard stack' });
const messageBox = (page: Page) => page.getByRole('textbox', { name: 'Message box' });

/**
 * Open a sample and wait until its first card is really shown. data-busy is "false" on the empty surface before any
 * stack loads, so it is not a load signal on its own: wait for the card name too, then for the Edit toggle, which
 * stays disabled until a stack is loaded.
 */
async function openSample(page: Page, key: string, firstCard: string): Promise<void> {
  await page.goto(`/?stack=${key}`);
  await expect(surface(page)).toHaveAttribute('data-card-name', firstCard);
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await expect(page.getByRole('radio', { name: 'Edit', exact: true })).toBeEnabled();
}

const FIRST_CARD: Record<string, string> = { quiz: 'Title', adventure: 'Entrance', flashcards: 'Title' };
interface FitRow {
  stack: string;
  card: string;
  name: string;
  style: string;
  hiddenUntilShown: boolean;
  rect: string;
  /** Height the text needs (content plus the 2px top and bottom padding) vs. the field's visible content box. */
  needH: number;
  boxH: number;
  needW: number;
  boxW: number;
  fits: boolean;
  scrolling: boolean;
}

/** Measure every field on the current card, in the browser, against its own visible box. */
async function measureFields(page: Page, stackKey: string, rects: Record<string, { name: string; w: number; h: number }>): Promise<FitRow[]> {
  return page.evaluate(({ stackKey, rects }) => {
    const s = document.querySelector('[role=application]') as HTMLElement;
    return [...s.querySelectorAll<HTMLElement>('.field')].map(f => {
      const t = (f.querySelector('.field-text') as HTMLElement | null) ?? f;
      const meta = rects[f.dataset.objectId ?? ''] ?? { name: '?', w: 0, h: 0 };
      const wasHidden = Boolean(f.hidden);
      if (wasHidden) f.hidden = false; // a hidden field is shown by a script later; check it as shown
      // Collapse the text element so scrollHeight is the height the text really needs, not the box it was given.
      const savedHeight = t.style.height;
      t.style.height = '0px';
      const needH = t.scrollHeight;
      const needW = t.scrollWidth;
      t.style.height = savedHeight;
      const boxH = f.clientHeight; // inside the field's own border
      const boxW = f.clientWidth;
      if (wasHidden) f.hidden = true;
      return {
        stack: stackKey,
        card: s.dataset.cardName ?? '?',
        name: meta.name,
        style: ['rect', 'scrolling', 'transparent'].find(k => f.classList.contains(`field-${k}`)) ?? '?',
        hiddenUntilShown: wasHidden,
        rect: `${meta.w}x${meta.h}`,
        needH, boxH, needW, boxW,
        fits: needH <= boxH && needW <= boxW,
        scrolling: f.classList.contains('field-scrolling'),
      };
    });
  }, { stackKey, rects });
}

test('every fixture field fits its rect at NecroField 16px on a 20px line', async ({ page }) => {
  const report: FitRow[] = [];
  for (const key of ['quiz', 'adventure', 'flashcards']) {
    await openSample(page, key, FIRST_CARD[key]);
    // Measure with the real bitmap face, never a fallback: wait for NecroField and confirm it is loaded and in use.
    const loaded = await page.evaluate(async () => {
      await document.fonts.load('16px "NecroField"', 'Aa');
      await document.fonts.ready;
      return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, ''));
    });
    expect(loaded).toContain('NecroField');
    const family = await page.evaluate(() => getComputedStyle(document.querySelector('.card-surface .field-text') ?? document.body).fontFamily);
    expect(family).toContain('NecroField');
    const stack = await page.evaluate(k => fetch(`/fixtures/${k}.necrocard.json`).then(r => r.json()), key) as {
      cards: { objects: { id: string; name: string; type: string; rect: { w: number; h: number } }[] }[];
      backgrounds: { objects: { id: string; name: string; type: string; rect: { w: number; h: number } }[] }[];
    };
    const rects: Record<string, { name: string; w: number; h: number }> = {};
    for (const o of [...stack.backgrounds.flatMap(b => b.objects), ...stack.cards.flatMap(c => c.objects)]) {
      rects[o.id] = { name: o.name, w: o.rect.w, h: o.rect.h };
    }
    for (let i = 1; i <= stack.cards.length; i++) {
      if (i > 1) {
        await messageBox(page).fill(`go to card ${i}`);
        await messageBox(page).press('Enter');
        await expect(surface(page)).toHaveAttribute('data-busy', 'false');
      }
      report.push(...await measureFields(page, key, rects));
    }
  }
  console.log('FIT ' + JSON.stringify(report));
  expect(report.length).toBeGreaterThan(10);
  expect(report.some(r => r.hiddenUntilShown)).toBe(true); // the flashcard answers really were checked as shown
  const bad = report.filter(r => !r.fits && !r.scrolling);
  expect(bad.map(r => `${r.stack}/${r.card}/${r.name} (${r.style}) rect ${r.rect}: needs ${r.needW}x${r.needH}, visible ${r.boxW}x${r.boxH}`)).toEqual([]);
});

const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });

test('the script editor textarea and its mirror share identical font metrics, in NecroScript', async ({ page }) => {
  await openSample(page, 'quiz', 'Title');
  await page.getByRole('radio', { name: 'Edit', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-mode', 'edit');
  await surface(page).locator('[data-object-name="BeginButton"]').dblclick({ force: true });
  const scriptBox = inspector(page).getByLabel('Script', { exact: true });
  await expect(scriptBox).toBeFocused();

  await scriptBox.fill('on mouseUp\n  beep\n  go next\nend mouseUp');
  await expect(scriptBox).toHaveValue('on mouseUp\n  beep\n  go next\nend mouseUp');

  const fontsCheck = await page.evaluate(() => document.fonts.check('16px NecroScript'));
  expect(fontsCheck).toBe(true);

  const metrics = await page.evaluate(() => {
    const ta = document.querySelector<HTMLTextAreaElement>('.code-editor-input')!;
    const mirror = document.querySelector<HTMLElement>('.code-editor-mirror')!;
    const gutter = document.querySelector<HTMLElement>('.code-editor-gutter')!;
    const pick = (el: Element) => {
      const cs = getComputedStyle(el);
      return {
        fontFamily: cs.fontFamily, fontSize: cs.fontSize, lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing, padding: cs.padding, tabSize: cs.tabSize,
      };
    };
    const gs = getComputedStyle(gutter);
    return {
      textarea: pick(ta),
      mirror: pick(mirror),
      // The gutter has its own horizontal padding; what must match is everything that sets a line's vertical position.
      gutter: { fontFamily: gs.fontFamily, fontSize: gs.fontSize, lineHeight: gs.lineHeight, letterSpacing: gs.letterSpacing, paddingTop: gs.paddingTop, paddingBottom: gs.paddingBottom },
      textareaPadding: { top: getComputedStyle(ta).paddingTop, bottom: getComputedStyle(ta).paddingBottom },
    };
  });
  expect(metrics.textarea).toEqual(metrics.mirror);
  expect(metrics.textarea.fontFamily).toContain('NecroScript');
  expect(metrics.textarea.fontSize).toBe('16px');
  expect(metrics.textarea.lineHeight).toBe('20px');
  expect(metrics.gutter).toEqual({
    fontFamily: metrics.textarea.fontFamily, fontSize: metrics.textarea.fontSize, lineHeight: metrics.textarea.lineHeight,
    letterSpacing: metrics.textarea.letterSpacing, paddingTop: metrics.textareaPadding.top, paddingBottom: metrics.textareaPadding.bottom,
  });
});

test('the card, chrome and editor really use the bundled fonts, at their native sizes', async ({ page }) => {
  await openSample(page, 'quiz', 'Title');
  // document.fonts.check is vacuously true for a family nobody declared, so load each face first and confirm it loaded.
  const status = await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('16px "NecroField"', 'Aa'), document.fonts.load('8px "NecroUI"', 'Aa'),
      document.fonts.load('700 16px "NecroUI"', 'Aa'), document.fonts.load('16px "NecroScript"', 'Aa'),
    ]);
    await document.fonts.ready;
    return {
      loaded: [...document.fonts].filter(f => f.status === 'loaded').map(f => `${f.family.replace(/"/g, '')} ${f.weight}`).sort(),
      check: ['16px NecroField', '8px NecroUI', '700 16px NecroUI', '16px NecroScript'].map(f => document.fonts.check(f)),
    };
  });
  expect(status.loaded).toEqual(['NecroField 400', 'NecroScript 400', 'NecroUI 400', 'NecroUI 700']);
  expect(status.check).toEqual([true, true, true, true]);

  const used = await page.evaluate(() => {
    const css = (sel: string) => { const cs = getComputedStyle(document.querySelector(sel)!); return `${cs.fontFamily} | ${cs.fontSize}/${cs.lineHeight} | ${cs.fontWeight}`; };
    return {
      cardButton: css('.card-surface .button'),
      cardField: css('.card-surface .field-text'),
      windowTitle: css('.card-window-title-label'),
      appName: css('.chrome-title'),
      toolbarButton: css('.chrome-toolbar .chrome-button'),
      picker: css('.stack-picker select'),
      messageBox: css('.message-box'),
    };
  });
  expect(used.cardButton).toMatch(/^"?NecroUI"?.* \| 8px\/.* \| 400$/);
  expect(used.cardField).toMatch(/^"?NecroField"?.* \| 16px\/20px \| 400$/);
  expect(used.windowTitle).toMatch(/^"?NecroUI"?.* \| 16px\/20px \| 700$/);
  expect(used.appName).toMatch(/^"?NecroUI"?.* \| 16px\/20px \| 700$/);
  expect(used.toolbarButton).toMatch(/^"?NecroField"?.* \| 16px\/20px \| 400$/);
  // A native <select> reports line-height "normal" whatever the CSS says (its height is set explicitly), so only the
  // family, size and weight are checked for the picker.
  expect(used.picker).toMatch(/^"?NecroField"?.* \| 16px\/.* \| 400$/);
  expect(used.messageBox).toMatch(/^"?NecroScript"?.* \| 16px\/20px \| 400$/);

  // The window title follows the open stack.
  await expect(page.locator('.card-window-title-label')).toHaveText('The Haunted Quiz');
});

test('a scrolling field with overflowing text shows its 50% dither track and thumb as soon as the card is shown', async ({ page }) => {
  await openSample(page, 'quiz', 'Title');
  await page.getByRole('radio', { name: 'Edit', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-mode', 'edit');
  await page.getByRole('button', { name: 'Add field', exact: true }).click();
  await expect(inspector(page).getByRole('heading', { level: 2 })).toHaveText('Field "Field 1"');
  await inspector(page).getByLabel('Style', { exact: true }).selectOption('scrolling');
  const lines = Array.from({ length: 8 }, (_, i) => `Line ${i + 1} of the crypt log.`).join('\n');
  await inspector(page).getByLabel('Text', { exact: true }).fill(lines);
  await inspector(page).getByLabel('Text', { exact: true }).blur();

  // Back to Browse rebuilds the card from scratch, in a detached tree, then inserts it: the case that used to
  // leave the track and thumb off until the first scroll.
  await page.getByRole('radio', { name: 'Browse', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-mode', 'browse');
  const field = surface(page).locator('.field-scrolling');
  await expect(field).toHaveCount(1);
  await expect(field.locator('.scroll-track--active')).toHaveCount(1);
  await expect(field.locator('.scroll-thumb')).toBeVisible();

  // The thumb really sits on the 50% dither tile (Vite inlines the small SVG, so check the tile itself: 32 black cells
  // of 64, in the checkerboard where x + y is even), and scrolling moves it.
  const bg = decodeURIComponent(await field.locator('.scroll-track').evaluate(el => getComputedStyle(el).backgroundImage));
  expect(bg).toContain('data:image/svg+xml');
  const cells = [...bg.matchAll(/x='(\d)' y='(\d)'/g)].map(m => [Number(m[1]), Number(m[2])]);
  expect(cells).toHaveLength(32);
  expect(cells.every(([x, y]) => (x + y) % 2 === 0)).toBe(true);
  const before = await field.locator('.scroll-thumb').evaluate(el => (el as HTMLElement).style.top);
  await field.locator('.scroll-arrow--down').click();
  await field.locator('.scroll-arrow--down').click();
  const after = await field.locator('.scroll-thumb').evaluate(el => (el as HTMLElement).style.top);
  expect(parseFloat(after)).toBeGreaterThan(parseFloat(before));
});

/** PNG width and height, read from the IHDR chunk. */
function pngSize(png: Uint8Array): { w: number; h: number } {
  const u32 = (i: number) => ((png[i] << 24) | (png[i + 1] << 16) | (png[i + 2] << 8) | png[i + 3]) >>> 0;
  return { w: u32(16), h: u32(20) };
}

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

test('the quiz title card at exactly 2x: the visual reference', async ({ page }) => {
  // Wide and tall enough for 2x, too short for 3x. The odd width and height make the 1027 × 711 window land on whole
  // pixels when centred (an even-sized viewport would put it on a half pixel and the capture would round outward).
  await page.setViewportSize({ width: 1441, height: 901 });
  await page.goto('/?stack=quiz');
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Title');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');
  await page.evaluate(async () => {
    await document.fonts.load('16px "NecroField"', 'Aa');
    await document.fonts.load('8px "NecroUI"', 'Aa');
    await document.fonts.load('700 16px "NecroUI"', 'Aa');
    await document.fonts.ready;
  });
  expect(await surface(page).evaluate(el => el.style.transform)).toBe('scale(2)');

  const win = page.locator('.card-window');
  // The window is the 1024 × 684 card plus its 24px title bar and its 1px / 2px borders.
  const box = await win.boundingBox();
  expect([box!.width, box!.height]).toEqual([1027, 711]);

  // Set UPDATE_REFERENCE=1 to rewrite the committed reference; otherwise this only checks the capture.
  const png = await win.screenshot(env.UPDATE_REFERENCE ? { path: 'docs/screenshots/retro-title-2x.png' } : {});
  expect(pngSize(png)).toEqual({ w: 1027, h: 711 });
});
