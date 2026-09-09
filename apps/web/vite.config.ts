/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_ORIGIN = process.env.VITE_DEV_API_ORIGIN ?? 'http://127.0.0.1:4000';

/**
 * Dev server proxies the API and the socket so the browser only ever talks to one origin
 * (same as Caddy in production, docs/12). Cookies stay first-party; no CORS in the app code.
 */
export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true, routesDirectory: './src/routes' }),
    react(),
    tailwindcss(),
    {
      // The open-graph tags in index.html need the site origin, which only the production build
      // knows (the web Dockerfile passes it as VITE_APP_URL). Vite leaves an undefined %VAR%
      // untouched, so this substitutes it explicitly and falls back to an empty origin, which
      // makes the URLs relative and harmless in a local build.
      name: 'crm-og-origin',
      transformIndexHtml: (html) =>
        html.replaceAll('%VITE_APP_URL%', (process.env.VITE_APP_URL ?? '').replace(/\/+$/, '')),
    },
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    strictPort: true,
    proxy: {
      '/api': { target: API_ORIGIN, changeOrigin: false },
      '/socket.io': { target: API_ORIGIN, ws: true, changeOrigin: false },
      '/public': { target: API_ORIGIN, changeOrigin: false },
    },
  },
  build: {
    sourcemap: true,
    target: 'es2023',
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'vendor', test: /node_modules[\\/](react|react-dom|scheduler|@tanstack)[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
