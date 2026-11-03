import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;
// Read CI without depending on @types/node (no other Node typings are needed in this repo).
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const CI = Boolean(env.CI);

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: true,
  forbidOnly: CI,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
  },
});
