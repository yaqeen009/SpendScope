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
    // Schema migrations need a direct (non-pooled) connection. Managed Postgres
    // services behind a pooler (Neon, Supabase, RDS Proxy) hand out a second URL
    // for exactly this; when it is present the CLI uses it for `migrate deploy`
    // and everything else. The running application never reads this file: it
    // uses DATABASE_URL through apps/api/src/lib/prisma.ts, so runtime traffic
    // stays on the pooled connection. With no DATABASE_URL_UNPOOLED (local
    // development, plain Postgres) migrations use DATABASE_URL as before.
    url: process.env.DATABASE_URL_UNPOOLED ?? env('DATABASE_URL'),
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL
      ? env('SHADOW_DATABASE_URL')
      : undefined,
  },
});
