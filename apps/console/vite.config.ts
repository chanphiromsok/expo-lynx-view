import tailwindcss from '@tailwindcss/postcss';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { fileURLToPath, URL } from 'node:url';

// The `dev` script runs Wrangler on port 8787 alongside Vite. Keeping API
// calls relative gives the browser the same origin in production and lets this
// local proxy preserve that contract with Vite HMR.
export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [
    react(),
    // ANALYZE=1 pnpm build opens a treemap of dist/stats.html after the
    // build — off by default so it never runs in CI/deploy.
    process.env.ANALYZE ? visualizer({ filename: 'dist/stats.html', gzipSize: true, brotliSize: true, template: 'treemap' }) : null,
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/health': 'http://127.0.0.1:8787',
      '/v1': 'http://127.0.0.1:8787',
    },
  },
  preview: {
    host: '127.0.0.1',
  },
});
