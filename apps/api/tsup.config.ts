import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle the workspace-shared source and the generated Prisma client.
  // `pg` ships native/optional bindings and must stay external.
  external: ['pg', 'pino', 'pino-pretty'],
  splitting: false,
  dts: false,
});
