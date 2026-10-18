import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The API runs on :4000 by default; requests are proxied in dev to avoid CORS. */
const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig(({ command, mode }) => {
  // `VITE_API_URL` is inlined into the bundle, so a split deployment that
  // forgets it ships a bundle calling `/api` on its own origin — where the
  // static host answers with its own 404 page rather than JSON. Say so at build
  // time, because the resulting failure is otherwise only visible in a browser.
  const fileEnv = loadEnv(mode, here, 'VITE_');
  const apiUrl = process.env.VITE_API_URL || fileEnv.VITE_API_URL;
  if (command === 'build' && !apiUrl) {
    console.warn(
      'VITE_API_URL is not set: the bundle will call /api on its own origin. ' +
        'That is correct when the API is proxied on the same origin. When the API is on a ' +
        'different domain — for example a Vercel SPA calling a Render API — set VITE_API_URL ' +
        'and build again, or the frontend will never reach the backend.',
    );
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(here, 'src'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: API_TARGET,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      // The production web server is plain Node, so its tests declare
      // `@vitest-environment node` and live next to the file they exercise.
      include: ['src/**/*.test.{ts,tsx}', 'server.test.mjs'],
      css: false,
      restoreMocks: true,
    },
  };
});
