import { prisma } from '../src/lib/prisma.ts';
import { logger } from '../src/lib/logger.ts';
import { resetDemoData } from '../src/lib/demo-data.ts';
import { ensureWorkspace } from '../src/modules/workspace/workspace.service.ts';

/**
 * Deterministic seed.
 *
 * Creates the default workspace (with the category catalogue and settings) and
 * then (re)loads the clearly-labelled demo dataset. Running it twice produces
 * the same result: the previous sample rows are removed first, so it never
 * duplicates and never touches imported rows.
 *
 * Usage:
 *   npm run db:seed                 # workspace + demo data
 *   SEED_DEMO=0 npm run db:seed     # workspace + categories only (empty dashboard)
 */
async function main(): Promise<void> {
  const workspace = await ensureWorkspace();
  logger.info({ workspaceId: workspace.id, created: workspace.created }, 'workspace ready');

  if (process.env.SEED_DEMO === '0') {
    logger.info('SEED_DEMO=0 — skipping demo dataset');
  } else {
    const result = await resetDemoData(workspace.id);
    logger.info(result, 'demo dataset seeded (all rows marked isSample=true)');
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    logger.error({ err: error }, 'seed failed');
    await prisma.$disconnect();
    process.exit(1);
  });
