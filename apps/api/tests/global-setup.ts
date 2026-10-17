import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

/**
 * Vitest global setup: applies committed migrations to the isolated test
 * database. This runs once per `vitest run`, before any spec file.
 *
 * The worker processes independently point Prisma at the test database in
 * `tests/setup.ts` (environment changes made here are not guaranteed to reach
 * worker threads).
 */
export default function globalSetup(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  loadEnv({ path: path.resolve(here, '../../../.env'), quiet: true });

  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to .env first.');
  }
  if (testUrl === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL — refusing to run tests.');
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: path.resolve(here, '..'),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });
}
