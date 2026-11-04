import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Summon: `npm run server:dev` listens on 8787; the browser calls same-origin /api in dev.
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    reporter: 'verbose',
    passWithNoTests: true,
  },
} as Parameters<typeof defineConfig>[0]);
