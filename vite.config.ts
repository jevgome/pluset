import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

/** Pyodide loads its runtime files at run time; ship them with the extension (no remote code in MV3). */
function copyPyodide(): Plugin {
  const files = ['pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
  return {
    name: 'copy-pyodide',
    apply: 'build',
    writeBundle() {
      const out = `${root}dist/pyodide`;
      mkdirSync(out, { recursive: true });
      for (const f of files) cpSync(`${root}node_modules/pyodide/${f}`, `${out}/${f}`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [copyPyodide()],
  optimizeDeps: { exclude: ['pyodide'] },
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    rollupOptions: {
      input: {
        app: `${root}app.html`,
        background: `${root}src/background.ts`,
      },
      output: {
        // The manifest points at a fixed service-worker filename.
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
