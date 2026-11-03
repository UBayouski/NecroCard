import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    reporter: 'verbose',
    passWithNoTests: true,
  },
} as Parameters<typeof defineConfig>[0]);
