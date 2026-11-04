// Shared Playwright `test` for every e2e spec: /api is answered by a mocked, unconfigured Summon server, so no
// spec depends on `npm run server:dev` and the page-load health check never hits the Vite proxy's dead target.
// Specs that need Summon (summon.spec.ts) register their own page.route handlers, which take precedence.
import { test as base, type Page } from '@playwright/test';

export { expect, type Page } from '@playwright/test';

export const UNCONFIGURED_MESSAGE = 'Summon is not configured on this server.';

export async function mockUnconfiguredServer(page: Page): Promise<void> {
  await page.route('**/api/health', route =>
    route.fulfill({ status: 200, json: { ok: false, model: 'gemini-3.5-flash-lite', remainingDay: 100 } }));
  await page.route('**/api/summon', route =>
    route.fulfill({
      status: 503,
      headers: { 'X-Summon-Remaining-Day': '100', 'X-Summon-Remaining-Ip': '10' },
      json: { ok: false, error: { kind: 'not_configured', message: UNCONFIGURED_MESSAGE } },
    }));
}

export const test = base.extend<{ unconfiguredServer: void }>({
  unconfiguredServer: [
    async ({ page }, use) => {
      await mockUnconfiguredServer(page);
      await use();
    },
    { auto: true },
  ],
});

/** Console errors and page errors, except the browser's own "Failed to load resource" for mocked /api errors. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    if (msg.text().startsWith('Failed to load resource') && msg.location().url.includes('/api/')) return;
    errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}
