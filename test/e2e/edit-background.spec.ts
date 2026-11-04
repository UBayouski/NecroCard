// Edit-background end to end (edit-background REQ-7.3). The fixtures have empty backgrounds, so the test creates
// the shared background object itself: toggle Edit Background, New Button lands on the background, and it then
// shows on every card that shares the background.
import { expect, test, type Page } from './apiMock.js';

const surface = (page: Page) => page.getByRole('application', { name: 'HyperCard stack' });
const mode = (page: Page, name: 'Browse' | 'Edit') => page.getByRole('radio', { name, exact: true });
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const titleBar = (page: Page) => page.locator('.card-window-title');

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

/** The rect of the selected object, read from the inspector's X/Y/W/H inputs. */
async function selectedRect(page: Page) {
  const n = async (label: string) => Number(await inspector(page).getByLabel(label, { exact: true }).inputValue());
  return { x: await n('X'), y: await n('Y'), w: await n('W'), h: await n('H') };
}

/** Select the first object on the active layer via Tab (avoids clicking inert card elements under the overlay). */
async function tabSelect(page: Page) {
  await surface(page).focus();
  await page.keyboard.press('Tab');
}

test('Edit Background: a new background button is shared across cards, moves, undoes, and the layer gates selection', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?stack=flashcards');
  await expect(surface(page)).toHaveAttribute('data-busy', 'false');

  // Enter Edit; retry the click if a still-settling load left the runtime briefly busy (the click is ignored
  // while busy, so a single click can be dropped under load).
  await expect(async () => {
    await mode(page, 'Edit').click();
    await expect(surface(page)).toHaveAttribute('data-mode', 'edit', { timeout: 1000 });
  }).toPass({ timeout: 10000 });

  // Toggle Edit Background with Ctrl+B; the title bar shows the stripe and the menu item is checked.
  await surface(page).focus();
  await page.keyboard.press('Control+b');
  await expect(titleBar(page)).toHaveClass(/card-window-title--editing-bg/);
  await page.getByRole('button', { name: 'Card', exact: true }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: /Edit Background/ })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');

  // New Button lands on the background and is selected.
  await page.getByRole('button', { name: 'Add button', exact: true }).click();
  await expect(inspector(page).getByRole('heading', { level: 2 })).toHaveText('Button "Button 1"');
  const buttonId = await surface(page).getAttribute('data-selected-id');
  const start = await selectedRect(page);

  // Go to the next card via the Card menu; the shared background button is there too.
  await page.getByRole('button', { name: 'Card', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Next', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Card1');
  await expect(surface(page).getByRole('button', { name: 'Button 1', exact: true })).toHaveCount(1);

  // Select it (Tab finds the single background object) and nudge it right/down by 10 each.
  await tabSelect(page);
  await expect(surface(page)).toHaveAttribute('data-selected-id', buttonId!);
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const moved = await selectedRect(page);
  expect(moved.x).toBe(start.x + 10);
  expect(moved.y).toBe(start.y + 10);

  // Back to the Title card: the shared button is moved there too.
  await page.getByRole('button', { name: 'Card', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Prev', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-card-name', 'Title');
  await tabSelect(page);
  await expect(surface(page)).toHaveAttribute('data-selected-id', buttonId!);
  expect(await selectedRect(page)).toMatchObject({ x: moved.x, y: moved.y });

  // Undo (the two nudges coalesce into one history entry): the button returns to its start position.
  await page.keyboard.press('Control+z');
  await tabSelect(page);
  expect(await selectedRect(page)).toMatchObject({ x: start.x, y: start.y });

  // Toggle Edit Background off: the stripe is gone. Tab now selects a card object (not the background button).
  await page.keyboard.press('Control+b');
  await expect(titleBar(page)).not.toHaveClass(/card-window-title--editing-bg/);
  await tabSelect(page);
  const cardSelId = await surface(page).getAttribute('data-selected-id');
  expect(cardSelId).not.toBe(buttonId); // a card object, not the background button
  // Cycle this card's own objects; the background "Button 1" is never among them.
  const names: string[] = [];
  for (let i = 0; i < 5; i++) {
    const heading = await inspector(page).getByRole('heading', { level: 2 }).textContent();
    if (heading) names.push(heading);
    await page.keyboard.press('Tab');
  }
  expect(names.length).toBeGreaterThan(0);
  expect(names.some(h => h.includes('Button 1'))).toBe(false);

  expect(errors).toEqual([]);
});
