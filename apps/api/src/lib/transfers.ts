import { randomUUID } from 'node:crypto';

import type { TransferSuggestionDTO } from '@spendscope/shared';

import { BadRequestError, ConflictError, NotFoundError } from './errors.ts';
import { prisma } from './prisma.ts';
import { toTransactionDTO } from './serializers.ts';

/**
 * Manual transfer pairing.
 *
 * The data model has no bank-account entity, and a `TRANSFER` row stores a
 * positive magnitude with no direction. Transfers are already excluded from
 * every income and expense total, so pairing cannot change any figure — it
 * exists to group the two sides of one movement so a user can reconcile them
 * and so the same movement is never counted as separate income and expense.
 *
 * Pairing is always explicit (a user action). Suggestions are advisory only and
 * are never applied automatically.
 */

const CATEGORY_SELECT = { select: { id: true, name: true, kind: true, color: true } } as const;

/** Maximum days between the two sides of one movement. */
export const TRANSFER_MAX_DAY_GAP = 5;
/** Maximum number of suggestions returned. */
const MAX_SUGGESTIONS = 20;
/** Maximum unpaired transfer rows scanned when building suggestions. */
const SUGGESTION_SCAN_LIMIT = 500;

function dayGap(a: Date, b: Date): number {
  return Math.abs(Math.round((a.getTime() - b.getTime()) / 86_400_000));
}

export async function linkTransfer(
  workspaceId: string,
  transactionId: string,
  counterpartId: string,
): Promise<{ transferGroupId: string }> {
  if (transactionId === counterpartId) {
    throw new BadRequestError('A transaction cannot be paired with itself');
  }

  const rows = await prisma.transaction.findMany({
    where: { id: { in: [transactionId, counterpartId] }, workspaceId },
    select: { id: true, type: true, amount: true, transactionDate: true, transferGroupId: true },
  });

  const first = rows.find((row) => row.id === transactionId);
  const second = rows.find((row) => row.id === counterpartId);
  if (!first || !second) throw new NotFoundError('Transaction');

  for (const row of [first, second]) {
    if (row.type !== 'TRANSFER') {
      throw new BadRequestError('Only TRANSFER transactions can be paired with each other');
    }
    if (row.transferGroupId) {
      throw new ConflictError('That transaction is already paired. Unlink it first.');
    }
  }

  if (!first.amount.equals(second.amount)) {
    throw new BadRequestError(
      `The two sides of a transfer must have the same amount (${first.amount.toFixed(2)} vs ${second.amount.toFixed(2)})`,
    );
  }

  const gap = dayGap(first.transactionDate, second.transactionDate);
  if (gap > TRANSFER_MAX_DAY_GAP) {
    throw new BadRequestError(`The two sides of a transfer must be within ${TRANSFER_MAX_DAY_GAP} days of each other`);
  }

  const transferGroupId = randomUUID();
  await prisma.$transaction([
    prisma.transaction.update({ where: { id: first.id }, data: { transferGroupId } }),
    prisma.transaction.update({ where: { id: second.id }, data: { transferGroupId } }),
  ]);

  return { transferGroupId };
}

/** Removes the pairing from both sides of a movement. Returns rows touched. */
export async function unlinkTransfer(workspaceId: string, transactionId: string): Promise<number> {
  const row = await prisma.transaction.findFirst({
    where: { id: transactionId, workspaceId },
    select: { id: true, transferGroupId: true },
  });
  if (!row) throw new NotFoundError('Transaction');
  if (!row.transferGroupId) {
    throw new BadRequestError('That transaction is not paired');
  }

  const result = await prisma.transaction.updateMany({
    where: { workspaceId, transferGroupId: row.transferGroupId },
    data: { transferGroupId: null },
  });
  return result.count;
}

/**
 * Suggests unpaired TRANSFER rows with the same amount within a few days of each
 * other. Deterministic and explainable; nothing is changed.
 */
export async function suggestTransfers(workspaceId: string): Promise<TransferSuggestionDTO[]> {
  const rows = await prisma.transaction.findMany({
    where: { workspaceId, type: 'TRANSFER', transferGroupId: null },
    include: { category: CATEGORY_SELECT },
    orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
    take: SUGGESTION_SCAN_LIMIT,
  });

  const byAmount = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.amount.toFixed(2);
    const bucket = byAmount.get(key);
    if (bucket) bucket.push(row);
    else byAmount.set(key, [row]);
  }

  const suggestions: TransferSuggestionDTO[] = [];
  const claimed = new Set<string>();

  for (const bucket of byAmount.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length && suggestions.length < MAX_SUGGESTIONS; i += 1) {
      const a = bucket[i]!;
      if (claimed.has(a.id)) continue;
      for (let j = i + 1; j < bucket.length; j += 1) {
        const b = bucket[j]!;
        if (claimed.has(b.id)) continue;
        const gap = dayGap(a.transactionDate, b.transactionDate);
        if (gap > TRANSFER_MAX_DAY_GAP) continue;

        claimed.add(a.id);
        claimed.add(b.id);
        suggestions.push({
          a: toTransactionDTO(a),
          b: toTransactionDTO(b),
          dayGap: gap,
          reason: `Both are transfers of ${a.amount.toFixed(2)}, ${gap} day(s) apart`,
        });
        break;
      }
    }
  }

  return suggestions;
}
