/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const CONSOLE_ORIGIN = process.env.VITE_DEV_CONSOLE_ORIGIN ?? 'http://127.0.0.1:4100';

/**
 * The console client (docs/21). Same arrangement as the CRM's: the dev server proxies the API and
 * the socket so the browser only ever talks to one origin, cookies stay first-party, and no CORS
 * handling leaks into the app code. Routes are declared in code rather than generated from files;
 * this app has eight of them.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    strictPort: true,
    proxy: {
      '/api': { target: CONSOLE_ORIGIN, changeOrigin: false },
      '/socket.io': { target: CONSOLE_ORIGIN, ws: true, changeOrigin: false },
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
