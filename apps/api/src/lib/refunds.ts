import type { TransactionType } from '@spendscope/shared';

import { BadRequestError, NotFoundError } from './errors.ts';
import { Decimal } from './money.ts';
import { prisma } from './prisma.ts';
import type { Prisma } from './prisma.ts';

/**
 * Refund linkage.
 *
 * A `REFUND` row may name the `EXPENSE` it reverses. The link is always
 * explicit — refunds are never matched automatically — and it makes three
 * guarantees:
 *
 *  1. The refund belongs to the same workspace as the original.
 *  2. The refund inherits the original's category, so category-level net spend
 *     (EXPENSE − REFUND) is attributed correctly without extra SQL.
 *  3. The refunded total can never exceed the original amount. Partial and
 *     repeated refunds are supported; over-refunding is rejected.
 *
 * Deleting the original does not delete the refund: the foreign key is
 * `ON DELETE SET NULL`, so the refund survives as an unlinked one.
 */

export type Db = Prisma.TransactionClient | typeof prisma;

export interface ResolvedRefund {
  refundOfTransactionId: string | null;
  categoryId: string | null;
  /**
   * Currency to persist. `null` is the workspace base currency. A linked refund
   * always takes the original's currency: reversing money in a different
   * currency is not something this system can represent without conversion.
   * `undefined` means "the caller did not ask to change it".
   */
  currency: string | null | undefined;
}

/** Sum of the refunds already linked to an original expense. */
export async function refundedTotal(
  db: Db,
  originalId: string,
  excludeRefundId?: string,
): Promise<Decimal> {
  const aggregate = await db.transaction.aggregate({
    where: {
      refundOfTransactionId: originalId,
      type: 'REFUND',
      ...(excludeRefundId ? { id: { not: excludeRefundId } } : {}),
    },
    _sum: { amount: true },
  });
  return aggregate._sum.amount ?? new Decimal(0);
}

/**
 * Validates a requested refund link and returns the columns to persist.
 *
 * When no link is requested the caller's category choice is passed through
 * unchanged (the returned `categoryId` is the caller's own value).
 */
export async function resolveRefundLink(params: {
  db?: Db;
  workspaceId: string;
  type: TransactionType;
  amount: string;
  refundOfTransactionId: string | null | undefined;
  categoryId: string | null;
  /** Desired currency, already normalised (`null` = base currency). */
  currency: string | null | undefined;
  /** Set when validating an update, so a refund cannot link to itself. */
  selfId?: string;
}): Promise<ResolvedRefund> {
  const db = params.db ?? prisma;
  const { workspaceId, type, amount, refundOfTransactionId, categoryId } = params;

  if (refundOfTransactionId === null || refundOfTransactionId === undefined) {
    return { refundOfTransactionId: null, categoryId, currency: params.currency };
  }

  if (type !== 'REFUND') {
    throw new BadRequestError('Only REFUND transactions can reference an original expense');
  }
  if (params.selfId && params.selfId === refundOfTransactionId) {
    throw new BadRequestError('A refund cannot reference itself');
  }

  const original = await db.transaction.findFirst({
    where: { id: refundOfTransactionId, workspaceId },
    select: { id: true, type: true, amount: true, categoryId: true, description: true, currency: true },
  });
  if (!original) throw new NotFoundError('Original transaction');
  if (original.type !== 'EXPENSE') {
    throw new BadRequestError('A refund can only reference an EXPENSE transaction');
  }

  // A refund reverses the original's money, so it must be in the same currency.
  const originalCurrency = original.currency ?? null;
  if (params.currency !== undefined && params.currency !== originalCurrency) {
    throw new BadRequestError(
      'A linked refund must be in the same currency as the original expense, because SpendScope does not convert currencies',
      { originalCurrency, refundCurrency: params.currency },
    );
  }

  // Category inheritance is enforced rather than silently applied, so the
  // client always knows which category the refund will count against.
  if (categoryId !== null && original.categoryId !== null && categoryId !== original.categoryId) {
    throw new BadRequestError(
      'A linked refund must use the same category as the original expense (or no category when the original has none)',
    );
  }
  if (categoryId !== null && original.categoryId === null) {
    throw new BadRequestError('The original expense has no category, so the refund cannot have one either');
  }

  const alreadyRefunded = await refundedTotal(db, original.id, params.selfId);
  const nextTotal = alreadyRefunded.plus(new Decimal(amount));
  if (nextTotal.greaterThan(original.amount)) {
    const remaining = Decimal.max(original.amount.minus(alreadyRefunded), new Decimal(0));
    throw new BadRequestError(
      `This refund would exceed the original expense. Refunded so far: ${alreadyRefunded.toFixed(2)} of ${original.amount.toFixed(2)} (${remaining.toFixed(2)} remaining).`,
      {
        originalAmount: original.amount.toFixed(2),
        alreadyRefunded: alreadyRefunded.toFixed(2),
        remaining: remaining.toFixed(2),
      },
    );
  }

  return { refundOfTransactionId: original.id, categoryId: original.categoryId, currency: originalCurrency };
}
