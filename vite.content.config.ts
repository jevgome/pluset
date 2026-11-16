// Second build for the zyBooks-page content script: one self-contained classic
// script (content scripts can't import ES module chunks). Runs after the main build.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome120',
    lib: {
      entry: `${root}src/content/explain.ts`,
      formats: ['iife'],
      name: 'plusetExplain',
      fileName: () => 'content.js',
    },
  },
});
