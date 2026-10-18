import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    // Load Prisma's runtime through Node, not through Vite's module runner.
    // Every query goes through it, and the transformed copy costs hundreds of
    // milliseconds per query — enough to time out specs that are fast on their
    // own. The application never runs this path: the built server is plain Node.
    server: {
      deps: {
        external: [/@prisma\//, /^pg$/, /^pg-/, /@prisma\/adapter-pg/],
      },
    },
    // Integration tests share one PostgreSQL database; running spec files in
    // parallel would let one file truncate tables another file is reading.
    fileParallelism: false,
    // Integration specs talk to a real database through Prisma, so their run time
    // follows database latency rather than assertion count. Prisma's runtime is
    // markedly slower inside the module runner than in the built server (hundreds
    // of milliseconds per query versus about one), and a spec that bulk-writes in
    // one transaction — a backup restore — is the slowest of them. The limit is
    // therefore generous: it exists to catch a hung test, not to measure speed.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
