import type {
  CreateTransactionInput,
  Paginated,
  TransactionDTO,
  TransactionQuery,
  UpdateTransactionInput,
} from '@spendscope/shared';

import { BadRequestError, NotFoundError } from '../../lib/errors.ts';
import { dateOnlyToUtcDate, dateOnlyRangeFilter, utcDateToDateOnly as toDateOnly } from '../../lib/dates.ts';
import { buildFingerprint, normalizeMerchant } from '../../lib/fingerprint.ts';
import { prisma } from '../../lib/prisma.ts';
import type { Prisma } from '../../lib/prisma.ts';
import { toTransactionDTO } from '../../lib/serializers.ts';

const CATEGORY_SELECT = { select: { id: true, name: true, kind: true, color: true } } as const;

/**
 * Validates the category/type relationship:
 *   - TRANSFER rows carry no category (account-level transfers are out of scope),
 *   - INCOME rows may only use an INCOME category,
 *   - EXPENSE and REFUND rows may only use an EXPENSE category.
 */
async function resolveCategoryId(
  workspaceId: string,
  categoryId: string | null | undefined,
  type: CreateTransactionInput['type'],
): Promise<string | null> {
  if (!categoryId) return null;

  if (type === 'TRANSFER') {
    throw new BadRequestError('Transfers cannot be assigned to a category');
  }

  const category = await prisma.category.findFirst({
    where: { id: categoryId, workspaceId },
    select: { id: true, kind: true, name: true },
  });
  if (!category) throw new NotFoundError('Category');

  const required = type === 'INCOME' ? 'INCOME' : 'EXPENSE';
  if (category.kind !== required) {
    const article = category.kind === 'INCOME' ? 'an income' : 'an expense';
    throw new BadRequestError(
      `"${category.name}" is ${article} category and cannot be used for ${type} transactions`,
    );
  }
  return category.id;
}

function buildWhere(workspaceId: string, query: Partial<TransactionQuery>): Prisma.TransactionWhereInput {
  const where: Prisma.TransactionWhereInput = { workspaceId };

  if (query.from || query.to) {
    where.transactionDate = dateOnlyRangeFilter(query.from, query.to);
  }
  if (query.search) {
    where.OR = [
      { description: { contains: query.search, mode: 'insensitive' } },
      { merchant: { contains: query.search, mode: 'insensitive' } },
      { notes: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (query.categoryId === 'uncategorized') {
    where.categoryId = null;
  } else if (query.categoryId) {
    where.categoryId = query.categoryId;
  }
  if (query.type && query.type.length > 0) {
    where.type = { in: query.type };
  }
  if (query.reviewStatus) {
    where.reviewStatus = query.reviewStatus;
  }
  if (query.importBatchId) {
    where.importBatchId = query.importBatchId;
  }
  if (query.minAmount || query.maxAmount) {
    where.amount = {
      ...(query.minAmount ? { gte: query.minAmount } : {}),
      ...(query.maxAmount ? { lte: query.maxAmount } : {}),
    };
  }
  return where;
}

function buildOrderBy(query: Partial<TransactionQuery>): Prisma.TransactionOrderByWithRelationInput[] {
  const direction = query.sortOrder ?? 'desc';
  const primary: Prisma.TransactionOrderByWithRelationInput =
    query.sortBy === 'amount'
      ? { amount: direction }
      : query.sortBy === 'description'
        ? { description: direction }
        : { transactionDate: direction };
  return [primary, { createdAt: 'desc' }];
}

export async function listTransactions(
  workspaceId: string,
  query: TransactionQuery,
): Promise<Paginated<TransactionDTO>> {
  const where = buildWhere(workspaceId, query);
  const page = query.page;
  const pageSize = query.pageSize;

  const [total, rows] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      include: { category: CATEGORY_SELECT },
      orderBy: buildOrderBy(query),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    data: rows.map(toTransactionDTO),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getTransaction(workspaceId: string, id: string): Promise<TransactionDTO> {
  const row = await prisma.transaction.findFirst({
    where: { id, workspaceId },
    include: { category: CATEGORY_SELECT },
  });
  if (!row) throw new NotFoundError('Transaction');
  return toTransactionDTO(row);
}

export async function createTransaction(
  workspaceId: string,
  input: CreateTransactionInput,
): Promise<TransactionDTO> {
  const categoryId = await resolveCategoryId(workspaceId, input.categoryId, input.type);
  const merchant = input.merchant ?? null;

  const row = await prisma.transaction.create({
    data: {
      workspaceId,
      transactionDate: dateOnlyToUtcDate(input.transactionDate),
      description: input.description,
      merchant,
      normalizedMerchant: normalizeMerchant(merchant),
      amount: input.amount,
      type: input.type,
      categoryId,
      notes: input.notes ?? null,
      reviewStatus: input.reviewStatus ?? 'NEEDS_REVIEW',
      fingerprint: buildFingerprint({
        transactionDate: input.transactionDate,
        description: input.description,
        amount: input.amount,
        type: input.type,
        merchant,
      }),
    },
    include: { category: CATEGORY_SELECT },
  });

  return toTransactionDTO(row);
}

export async function updateTransaction(
  workspaceId: string,
  id: string,
  input: UpdateTransactionInput,
): Promise<TransactionDTO> {
  const existing = await prisma.transaction.findFirst({ where: { id, workspaceId } });
  if (!existing) throw new NotFoundError('Transaction');

  const type = input.type ?? existing.type;
  const categoryId =
    input.categoryId !== undefined
      ? await resolveCategoryId(workspaceId, input.categoryId, type)
      : type !== existing.type && existing.categoryId
        ? await resolveCategoryId(workspaceId, existing.categoryId, type)
        : undefined;

  const transactionDate = input.transactionDate ?? undefined;
  const description = input.description ?? existing.description;
  const amount = input.amount ?? existing.amount.toFixed(2);
  const merchant = input.merchant !== undefined ? (input.merchant ?? null) : existing.merchant;
  const fingerprintDate = transactionDate ?? toDateOnly(existing.transactionDate);

  const row = await prisma.transaction.update({
    where: { id },
    data: {
      ...(transactionDate ? { transactionDate: dateOnlyToUtcDate(transactionDate) } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.merchant !== undefined ? { merchant, normalizedMerchant: normalizeMerchant(merchant) } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(categoryId !== undefined ? { categoryId } : {}),
      ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
      ...(input.reviewStatus !== undefined ? { reviewStatus: input.reviewStatus } : {}),
      fingerprint: buildFingerprint({
        transactionDate: fingerprintDate,
        description,
        amount,
        type,
        merchant,
      }),
    },
    include: { category: CATEGORY_SELECT },
  });

  return toTransactionDTO(row);
}

export async function deleteTransaction(workspaceId: string, id: string): Promise<void> {
  const existing = await prisma.transaction.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!existing) throw new NotFoundError('Transaction');
  await prisma.transaction.delete({ where: { id } });
}

export async function countUnreviewed(workspaceId: string): Promise<number> {
  return prisma.transaction.count({ where: { workspaceId, reviewStatus: 'NEEDS_REVIEW' } });
}
