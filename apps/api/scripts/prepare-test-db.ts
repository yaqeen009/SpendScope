import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

/**
 * Applies committed migrations to the isolated test database.
 * Never runs against `DATABASE_URL` unless it is explicit that they match.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../../.env'), quiet: true });

const testUrl = process.env.TEST_DATABASE_URL;

if (!testUrl) {
  console.error('TEST_DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

if (testUrl === process.env.DATABASE_URL) {
  console.error('TEST_DATABASE_URL must differ from DATABASE_URL — refusing to run.');
  process.exit(1);
}

execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: path.resolve(here, '..'),
  env: { ...process.env, DATABASE_URL: testUrl },
  stdio: 'inherit',
});

console.log('Test database is migrated and ready.');
