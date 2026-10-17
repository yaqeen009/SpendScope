import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { config as loadEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

const here = path.dirname(fileURLToPath(import.meta.url));

// Prisma ORM 7 no longer loads `.env` automatically. The repository keeps a
// single `.env` at the root (two levels up from apps/api).
loadEnv({ path: path.resolve(here, '../../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL
      ? env('SHADOW_DATABASE_URL')
      : undefined,
  },
});
