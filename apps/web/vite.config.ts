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
  // `VITE_API_URL` is inlined into the bundle. Leaving it unset is the intended
  // configuration for the Vercel + Render split: the SPA calls `/api` on its own
  // origin and the `vercel.json` rewrite proxies that to the API, which keeps
  // the session cookie first-party. If no rewrite is configured, the static host
  // answers `/api/...` with its own plain-text 404 and the frontend never
  // reaches the backend — a failure otherwise visible only in the browser — so
  // say at build time which of the two this is.
  const fileEnv = loadEnv(mode, here, 'VITE_');
  const apiUrl = process.env.VITE_API_URL || fileEnv.VITE_API_URL;
  if (command === 'build' && !apiUrl) {
    console.warn(
      'VITE_API_URL is not set: the bundle will call /api on its own origin.\n' +
        '  Correct when `/api/*` is proxied on the same origin — check `vercel.json`\n' +
        '  (or the host\'s equivalent rewrites) has the rewrite. This keeps the session\n' +
        '  cookie first-party, which mobile browsers require.\n' +
        '  If nothing proxies /api/*, every request answers 404 and the app cannot\n' +
        '  reach its API. Set VITE_API_URL and build again — but a direct cross-origin\n' +
        '  call makes the cookie third-party, which Safari/iOS and Chrome on Android\n' +
        '  block. See docs/DEPLOYMENT.md, "One origin without a custom domain".',
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
