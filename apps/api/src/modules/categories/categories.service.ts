import type { CategoryDTO, DeleteCategoryQuery, CreateCategoryInput, UpdateCategoryInput } from '@spendscope/shared';

import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.ts';
import { prisma } from '../../lib/prisma.ts';
import { translatePrismaError } from '../../lib/prisma-errors.ts';
import { toCategoryDTO } from '../../lib/serializers.ts';
import { Decimal } from '../../lib/money.ts';

/**
 * Lifetime total per category:
 *   EXPENSE categories → Σ EXPENSE − Σ REFUND
 *   INCOME categories  → Σ INCOME
 * TRANSFER rows are excluded (they never belong to a category).
 */
async function lifetimeTotals(workspaceId: string): Promise<Map<string, { total: Decimal; count: number }>> {
  const grouped = await prisma.transaction.groupBy({
    by: ['categoryId', 'type'],
    where: { workspaceId, categoryId: { not: null } },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const totals = new Map<string, { total: Decimal; count: number }>();
  for (const row of grouped) {
    if (!row.categoryId) continue;
    const current = totals.get(row.categoryId) ?? { total: new Decimal(0), count: 0 };
    const sum = row._sum.amount ?? new Decimal(0);
    const delta = row.type === 'REFUND' ? sum.negated() : sum;
    totals.set(row.categoryId, {
      total: current.total.plus(delta),
      count: current.count + row._count._all,
    });
  }
  return totals;
}

export async function listCategories(workspaceId: string): Promise<CategoryDTO[]> {
  const [categories, totals] = await Promise.all([
    prisma.category.findMany({
      where: { workspaceId },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    }),
    lifetimeTotals(workspaceId),
  ]);

  return categories.map((category) => {
    const stats = totals.get(category.id);
    return toCategoryDTO({
      ...category,
      transactionCount: stats?.count ?? 0,
      lifetimeTotal: stats?.total ?? new Decimal(0),
    });
  });
}

export async function getCategory(workspaceId: string, id: string): Promise<CategoryDTO> {
  const category = await prisma.category.findFirst({ where: { id, workspaceId } });
  if (!category) throw new NotFoundError('Category');
  const totals = await lifetimeTotals(workspaceId);
  const stats = totals.get(category.id);
  return toCategoryDTO({
    ...category,
    transactionCount: stats?.count ?? 0,
    lifetimeTotal: stats?.total ?? new Decimal(0),
  });
}

export async function createCategory(
  workspaceId: string,
  input: CreateCategoryInput,
): Promise<CategoryDTO> {
  try {
    const category = await prisma.category.create({
      data: {
        workspaceId,
        name: input.name,
        kind: input.kind,
        color: input.color ?? null,
        description: input.description ?? null,
        isDefault: false,
      },
    });
    return toCategoryDTO({ ...category, transactionCount: 0 });
  } catch (error) {
    translatePrismaError(error, { conflict: `A category named "${input.name}" already exists` });
  }
}

export async function updateCategory(
  workspaceId: string,
  id: string,
  input: UpdateCategoryInput,
): Promise<CategoryDTO> {
  const existing = await prisma.category.findFirst({ where: { id, workspaceId } });
  if (!existing) throw new NotFoundError('Category');

  if (input.kind && input.kind !== existing.kind) {
    const linked = await prisma.transaction.count({ where: { categoryId: id, workspaceId } });
    if (linked > 0) {
      throw new ConflictError(
        'The category classification cannot be changed while transactions are assigned to it.',
        { linkedTransactions: linked },
      );
    }
  }

  try {
    const category = await prisma.category.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.color !== undefined ? { color: input.color ?? null } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      },
    });
    return getCategory(workspaceId, category.id);
  } catch (error) {
    translatePrismaError(error, { resource: 'Category', conflict: 'A category with that name already exists' });
  }
}

export async function deleteCategory(
  workspaceId: string,
  id: string,
  options: DeleteCategoryQuery,
): Promise<{ deleted: true; reassigned: number; uncategorized: number }> {
  const category = await prisma.category.findFirst({ where: { id, workspaceId } });
  if (!category) throw new NotFoundError('Category');

  const linked = await prisma.transaction.count({ where: { categoryId: id, workspaceId } });

  if (linked > 0 && options.strategy === 'block') {
    throw new ConflictError(
      `This category still has ${linked} transaction${linked === 1 ? '' : 's'}. Choose to reassign them or mark them uncategorized.`,
      { linkedTransactions: linked },
    );
  }

  if (options.strategy === 'reassign') {
    if (!options.reassignTo) {
      throw new BadRequestError('`reassignTo` is required when the strategy is "reassign"');
    }
    if (options.reassignTo === id) {
      throw new BadRequestError('Transactions cannot be reassigned to the category being deleted');
    }
    const target = await prisma.category.findFirst({
      where: { id: options.reassignTo, workspaceId },
    });
    if (!target) throw new NotFoundError('Reassignment category');
    if (target.kind !== category.kind) {
      throw new BadRequestError(
        `Cannot reassign ${category.kind} transactions to a ${target.kind} category`,
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    let reassigned = 0;
    let uncategorized = 0;

    if (linked > 0 && options.strategy === 'reassign' && options.reassignTo) {
      const result = await tx.transaction.updateMany({
        where: { categoryId: id, workspaceId },
        data: { categoryId: options.reassignTo },
      });
      reassigned = result.count;
    } else if (linked > 0) {
      const result = await tx.transaction.updateMany({
        where: { categoryId: id, workspaceId },
        data: { categoryId: null },
      });
      uncategorized = result.count;
    }

    // Category budgets cascade-delete with the category (see schema comment).
    await tx.category.delete({ where: { id } });
    return { deleted: true as const, reassigned, uncategorized };
  });
}
