import { DEFAULT_CATEGORIES } from '@spendscope/shared';

import { prisma } from '../../lib/prisma.ts';
import type { Prisma } from '../../lib/prisma.ts';

export const DEFAULT_WORKSPACE_NAME = 'Personal';

/**
 * The MVP is single-workspace. Every service still scopes its queries by
 * `workspaceId` so that adding real authentication later is an additive change
 * (resolve the id from the session) rather than a rewrite.
 *
 * These helpers accept an optional transaction client so bootstrap can create
 * the workspace, its categories and its settings atomically.
 */

export type Db = Prisma.TransactionClient | typeof prisma;

export async function ensureDefaultCategories(db: Db, workspaceId: string): Promise<number> {
  const existing = await db.category.count({ where: { workspaceId } });
  if (existing > 0) return 0;

  await db.category.createMany({
    data: DEFAULT_CATEGORIES.map((category) => ({
      workspaceId,
      name: category.name,
      kind: category.kind,
      color: category.color,
      description: category.description,
      isDefault: true,
    })),
    skipDuplicates: true,
  });
  return DEFAULT_CATEGORIES.length;
}

/**
 * Idempotently creates the default workspace with its category catalogue and
 * settings row. Safe to call on every server start and at the top of the test
 * suite.
 */
export async function ensureWorkspace(): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.workspace.findFirst({
    where: { ownerUserId: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (existing) {
    await ensureDefaultCategories(prisma, existing.id);
    await prisma.settings.upsert({
      where: { workspaceId: existing.id },
      update: {},
      create: { workspaceId: existing.id },
    });
    return { id: existing.id, created: false };
  }

  const workspace = await prisma.$transaction(async (tx) => {
    const created = await tx.workspace.create({
      data: { name: DEFAULT_WORKSPACE_NAME },
      select: { id: true },
    });
    await ensureDefaultCategories(tx, created.id);
    await tx.settings.create({ data: { workspaceId: created.id } });
    return created;
  });

  return { id: workspace.id, created: true };
}
