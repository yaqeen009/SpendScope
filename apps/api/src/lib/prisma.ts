import { PrismaPg } from '@prisma/adapter-pg';

import { env } from '../config/env.ts';
import { Prisma, PrismaClient } from '../generated/prisma/client.ts';

export { Prisma };
export type PrismaNamespace = typeof Prisma;

/**
 * Prisma ORM 7 requires an explicit driver adapter. `PrismaPg` wraps `node-pg`;
 * connection pooling therefore follows `pg` defaults rather than the old
 * Rust-engine defaults, so a connect timeout is set explicitly.
 */
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
  max: env.isTest ? 5 : 10,
});

export const prisma = new PrismaClient({
  adapter,
  log: env.isProduction ? ['warn', 'error'] : ['warn', 'error'],
});

export type PrismaClientType = typeof prisma;
