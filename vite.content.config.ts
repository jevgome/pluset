// Second build for the zyBooks-page content script: one self-contained classic
// script (content scripts can't import ES module chunks). Runs after the main build.
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * Chrome refuses content scripts containing Unicode noncharacters such as U+FFFF
 * ("isn't UTF-8 encoded"), and KaTeX's lexer has one in a regex. Escape every
 * non-ASCII UTF-16 unit as \\uXXXX, which means the same thing in strings, regexes and identifiers.
 */
function asciiOnly(): Plugin {
  return {
    name: 'ascii-only',
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        chunk.code = chunk.code.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
      }
    },
  };
}

export default defineConfig({
  plugins: [asciiOnly()],
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
