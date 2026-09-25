import { defineConfig } from 'vitest/config';

// `base: './'` emits relative asset URLs, so the same build works at the root of a
// domain, under a GitHub Pages project path (/<repo>/), or from any static server.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
