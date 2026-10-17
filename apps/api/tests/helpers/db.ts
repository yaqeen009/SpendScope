import { prisma } from '../../src/lib/prisma.ts';
import { importPreviewStore } from '../../src/modules/imports/preview-store.instance.ts';
import { ensureWorkspace } from '../../src/modules/workspace/workspace.service.ts';

/**
 * Truncates every application table and re-creates the default workspace with
 * its category catalogue. Safe to call between test files/cases — this is the
 * isolated test database, never a development or production one.
 */
export async function resetDatabase(): Promise<string> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Transaction", "Budget", "ImportBatch", "Category", "Settings", "Workspace" RESTART IDENTITY CASCADE',
  );
  importPreviewStore.stop();
  importPreviewStore.start();
  const { id } = await ensureWorkspace();
  return id;
}

export async function countRows(table: 'Transaction' | 'Category' | 'Budget' | 'ImportBatch'): Promise<number> {
  const result = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT COUNT(*)::bigint AS count FROM "${table}"`);
  return Number(result[0]?.count ?? 0);
}
