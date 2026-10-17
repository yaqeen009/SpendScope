import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import { afterAll } from 'vitest';

import { prisma } from '../src/lib/prisma.ts';

/**
 * Per-worker setup. Runs before any spec file is imported, so the Prisma client
 * (created at import time) already points at the test database.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../../.env'), quiet: true });

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to .env first.');
}
if (testUrl === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL — refusing to run tests.');
}

process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
process.env.IMPORT_PREVIEW_TTL_MINUTES = process.env.IMPORT_PREVIEW_TTL_MINUTES ?? '30';

afterAll(async () => {
  await prisma.$disconnect();
});
