import type { DismissRecurringInput, RecurringQuery, RecurringSeriesDTO } from '@spendscope/shared';

import { NotFoundError } from '../../lib/errors.ts';
import { prisma } from '../../lib/prisma.ts';
import { detectRecurringSeries, type RecurringRow } from '../../lib/recurring.ts';
import { dateOnlyToUtcDate, utcDateToDateOnly } from '../../lib/dates.ts';
import { addMonths, todayDateOnly } from '@spendscope/shared';

/**
 * Recurring-transaction detection.
 *
 * Read-only: this endpoint never writes a transaction, a budget or a
 * subscription record. Detection runs on the data already stored, and the only
 * write anywhere in this module is remembering a dismissal.
 */

const MAX_SCAN_ROWS = 20_000;

/**
 * How far back detection looks. A cancellation or a skipped month should break a
 * series, so the window matters: without one, a subscription cancelled a year
 * ago would still be reported.
 */
async function loadRows(workspaceId: string, months: number, today = todayDateOnly()): Promise<RecurringRow[]> {
  const from = addMonths(today, -months);

  const rows = await prisma.transaction.findMany({
    where: {
      workspaceId,
      transactionDate: { gte: dateOnlyToUtcDate(from) },
      type: { in: ['INCOME', 'EXPENSE', 'REFUND'] },
    },
    select: {
      id: true,
      transactionDate: true,
      description: true,
      merchant: true,
      amount: true,
      type: true,
    },
    orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
    take: MAX_SCAN_ROWS,
  });

  return rows.map((row) => ({
    id: row.id,
    transactionDate: utcDateToDateOnly(row.transactionDate),
    description: row.description,
    merchant: row.merchant,
    amount: row.amount.toFixed(2),
    type: row.type,
  }));
}

export async function listRecurringSeries(
  workspaceId: string,
  query: RecurringQuery,
): Promise<RecurringSeriesDTO[]> {
  const [rows, dismissals] = await Promise.all([
    loadRows(workspaceId, query.months),
    prisma.recurringDismissal.findMany({
      where: { workspaceId },
      select: { seriesKey: true },
    }),
  ]);

  const dismissed = new Set(dismissals.map((row) => row.seriesKey));
  const series = detectRecurringSeries(rows).map<RecurringSeriesDTO>((item) =>
    dismissed.has(item.seriesKey) ? { ...item, dismissed: true } : item,
  );

  return query.includeDismissed ? series : series.filter((item) => !item.dismissed);
}

export async function dismissRecurringSeries(
  workspaceId: string,
  input: DismissRecurringInput,
): Promise<{ seriesKey: string; name: string }> {
  // Dismissing something that was never detected is a client bug, but it is
  // also harmless to record — except that a typo would silently hide a real
  // series later. Require the key to match a currently detected series.
  const detected = await listRecurringSeries(workspaceId, { months: 18, includeDismissed: true });
  const match = detected.find((item) => item.seriesKey === input.seriesKey);
  if (!match) throw new NotFoundError('Recurring series');

  await prisma.recurringDismissal.upsert({
    where: { workspaceId_seriesKey: { workspaceId, seriesKey: input.seriesKey } },
    create: {
      workspaceId,
      seriesKey: input.seriesKey,
      name: input.name,
      reason: input.reason ?? null,
    },
    update: { name: input.name, reason: input.reason ?? null },
  });

  return { seriesKey: input.seriesKey, name: input.name };
}

export async function undismissRecurringSeries(workspaceId: string, seriesKey: string): Promise<number> {
  const result = await prisma.recurringDismissal.deleteMany({ where: { workspaceId, seriesKey } });
  if (result.count === 0) throw new NotFoundError('Recurring series dismissal');
  return result.count;
}
