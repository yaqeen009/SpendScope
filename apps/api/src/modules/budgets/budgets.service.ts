import {
  endOfMonth,
  monthKeyToDate,
  type BudgetDTO,
  type BudgetProgressDTO,
  type BudgetProgressItem,
  type BudgetQuery,
  type CreateBudgetInput,
  type UpdateBudgetInput,
} from '@spendscope/shared';

import { BadRequestError, NotFoundError } from '../../lib/errors.ts';
import { fetchCategoryExpenseTotals } from '../../lib/aggregates.ts';
import { monthKeyToUtcDate } from '../../lib/dates.ts';
import { computeBudgetProgress } from '../../lib/finance.ts';
import { Decimal, decimalToString, budgetState, usageFraction } from '../../lib/money.ts';
import { prisma } from '../../lib/prisma.ts';
import { translatePrismaError } from '../../lib/prisma-errors.ts';
import { toBudgetDTO } from '../../lib/serializers.ts';

const CATEGORY_SELECT = { select: { id: true, name: true, kind: true, color: true } } as const;

/**
 * Budget rules:
 *   - Budgets only apply to **expense** categories, or to the single total
 *     monthly expense budget (`categoryId = null`).
 *   - Amounts must be greater than zero.
 *   - One budget per (workspace, month, category) and one total budget per
 *     (workspace, month); both are database constraints.
 */
async function assertBudgetCategory(workspaceId: string, categoryId: string | null): Promise<void> {
  if (categoryId === null) return;
  const category = await prisma.category.findFirst({
    where: { id: categoryId, workspaceId },
    select: { kind: true, name: true },
  });
  if (!category) throw new NotFoundError('Category');
  if (category.kind !== 'EXPENSE') {
    throw new BadRequestError(`Budgets can only be set for expense categories ("${category.name}" is income)`);
  }
}

function assertPositiveAmount(amount: string): void {
  if (new Decimal(amount).lte(0)) {
    throw new BadRequestError('Budget amount must be greater than zero');
  }
}

export async function listBudgets(workspaceId: string, query: BudgetQuery): Promise<BudgetDTO[]> {
  const where: { workspaceId: string; month?: Date | { gte?: Date; lte?: Date } } = { workspaceId };
  if (query.month) {
    where.month = monthKeyToUtcDate(query.month);
  } else if (query.from || query.to) {
    const month: { gte?: Date; lte?: Date } = {};
    if (query.from) month.gte = monthKeyToUtcDate(query.from);
    if (query.to) month.lte = monthKeyToUtcDate(query.to);
    where.month = month;
  }

  const rows = await prisma.budget.findMany({
    where,
    include: { category: CATEGORY_SELECT },
    orderBy: [{ month: 'desc' }, { categoryId: 'asc' }],
  });
  return rows.map(toBudgetDTO);
}

export async function getBudget(workspaceId: string, id: string): Promise<BudgetDTO> {
  const row = await prisma.budget.findFirst({
    where: { id, workspaceId },
    include: { category: CATEGORY_SELECT },
  });
  if (!row) throw new NotFoundError('Budget');
  return toBudgetDTO(row);
}

export async function createBudget(workspaceId: string, input: CreateBudgetInput): Promise<BudgetDTO> {
  const categoryId = input.categoryId ?? null;
  await assertBudgetCategory(workspaceId, categoryId);
  assertPositiveAmount(input.amount);

  try {
    const row = await prisma.budget.create({
      data: {
        workspaceId,
        month: monthKeyToUtcDate(input.month),
        amount: input.amount,
        categoryId,
      },
      include: { category: CATEGORY_SELECT },
    });
    return toBudgetDTO(row);
  } catch (error) {
    translatePrismaError(error, {
      conflict: categoryId
        ? 'A budget for this category already exists for that month'
        : 'A total budget already exists for that month',
    });
  }
}

export async function updateBudget(
  workspaceId: string,
  id: string,
  input: UpdateBudgetInput,
): Promise<BudgetDTO> {
  const existing = await prisma.budget.findFirst({ where: { id, workspaceId } });
  if (!existing) throw new NotFoundError('Budget');

  if (input.categoryId !== undefined) {
    await assertBudgetCategory(workspaceId, input.categoryId ?? null);
  }
  if (input.amount !== undefined) assertPositiveAmount(input.amount);

  try {
    const row = await prisma.budget.update({
      where: { id },
      data: {
        ...(input.month !== undefined ? { month: monthKeyToUtcDate(input.month) } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId ?? null } : {}),
      },
      include: { category: CATEGORY_SELECT },
    });
    return toBudgetDTO(row);
  } catch (error) {
    translatePrismaError(error, { resource: 'Budget', conflict: 'A conflicting budget already exists for that month' });
  }
}

export async function deleteBudget(workspaceId: string, id: string): Promise<void> {
  const existing = await prisma.budget.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!existing) throw new NotFoundError('Budget');
  await prisma.budget.delete({ where: { id } });
}

/** Actual spending against every budget for a month. */
export async function getBudgetProgress(workspaceId: string, month: string): Promise<BudgetProgressDTO> {
  const range = { from: monthKeyToDate(month), to: endOfMonth(monthKeyToDate(month)) };

  const [budgets, totals] = await Promise.all([
    prisma.budget.findMany({
      where: { workspaceId, month: monthKeyToUtcDate(month) },
      include: { category: CATEGORY_SELECT },
      orderBy: { categoryId: 'asc' },
    }),
    fetchCategoryExpenseTotals(workspaceId, range),
  ]);

  const items: BudgetProgressItem[] = budgets.map((budget) => {
    const spent =
      budget.categoryId === null
        ? totals.total
        : (totals.byCategory.get(budget.categoryId) ?? new Decimal(0));
    return computeBudgetProgress({
      budgetId: budget.id,
      month,
      categoryId: budget.categoryId,
      categoryName: budget.category?.name ?? null,
      categoryColor: budget.category?.color ?? null,
      budgetAmount: budget.amount,
      spent,
    });
  });

  items.sort((a, b) => {
    if (a.isTotalBudget !== b.isTotalBudget) return a.isTotalBudget ? -1 : 1;
    return b.percentUsed - a.percentUsed;
  });

  const totalItem = items.find((item) => item.isTotalBudget);
  const total = totalItem
    ? {
        budgetAmount: totalItem.budgetAmount,
        spent: totalItem.spent,
        remaining: totalItem.remaining,
        percentUsed: usageFraction(new Decimal(totalItem.spent), new Decimal(totalItem.budgetAmount)),
        state: budgetState(usageFraction(new Decimal(totalItem.spent), new Decimal(totalItem.budgetAmount))),
      }
    : null;

  return { month, items, total };
}

/** Used by the analytics module to avoid a second import cycle. */
export { decimalToString };
