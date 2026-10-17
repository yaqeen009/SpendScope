import { addMonths, daysInMonth, endOfMonth, monthKey, startOfMonth, todayDateOnly } from '@spendscope/shared';

import { prisma } from './prisma.ts';
import { buildFingerprint, normalizeMerchant } from './fingerprint.ts';
import { monthKeyToUtcDate, dateOnlyToUtcDate } from './dates.ts';

/**
 * Deterministic demo dataset.
 *
 * Every row is marked `isSample = true` and uses fictional merchants and
 * amounts. It is never mixed into a user's imported data silently: the seed
 * script clears previous sample rows first, and the Settings page exposes an
 * explicit "reset demo data" action.
 *
 * The generator uses a seeded PRNG so the dataset is reproducible across runs.
 */

export interface SeedDemoOptions {
  /** Number of months to generate ending with the current month. Default 6. */
  months?: number;
  /** Injectable "today" (YYYY-MM-DD) for deterministic tests. */
  today?: string;
  /** PRNG seed. */
  seed?: number;
}

interface PendingTransaction {
  transactionDate: string;
  description: string;
  merchant: string | null;
  amount: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'REFUND';
  category: string | null;
  notes: string | null;
  reviewStatus: 'NEEDS_REVIEW' | 'REVIEWED';
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampDay(month: string, day: number): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const max = daysInMonth(year, monthNumber);
  return `${month}-${String(Math.min(day, max)).padStart(2, '0')}`;
}

export async function clearDemoData(workspaceId: string): Promise<{ transactions: number; budgets: number }> {
  const [transactions, budgets] = await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { workspaceId, isSample: true } }),
    prisma.budget.deleteMany({ where: { workspaceId } }),
  ]);
  return { transactions: transactions.count, budgets: budgets.count };
}

export async function seedDemoData(
  workspaceId: string,
  options: SeedDemoOptions = {},
): Promise<{ transactions: number; budgets: number }> {
  const months = options.months ?? 6;
  const today = options.today ?? todayDateOnly();
  const random = mulberry32(options.seed ?? 20260214);

  const categories = await prisma.category.findMany({
    where: { workspaceId },
    select: { id: true, name: true },
  });
  const categoryId = new Map(categories.map((category) => [category.name, category.id]));

  const between = (min: number, max: number): number =>
    Math.round((min + random() * (max - min)) * 100) / 100;

  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

  const rows: PendingTransaction[] = [];

  const currentMonth = monthKey(today);

  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const month = monthKey(addMonths(`${currentMonth}-01`, -offset));
    // Do not generate future-dated rows inside the current month.
    const isCurrentMonth = offset === 0;

    const add = (partial: Omit<PendingTransaction, 'transactionDate'> & { day: number }): void => {
      const date = clampDay(month, partial.day);
      if (date > today) return;
      rows.push({
        transactionDate: date,
        description: partial.description,
        merchant: partial.merchant,
        amount: partial.amount,
        type: partial.type,
        category: partial.category,
        notes: partial.notes,
        reviewStatus: partial.reviewStatus,
      });
    };

    add({
      day: 26,
      description: 'Monthly salary — Acme Corp',
      merchant: 'Acme Corp',
      amount: between(6000, 6500).toFixed(2),
      type: 'INCOME',
      category: 'Salary',
      notes: null,
      reviewStatus: 'REVIEWED',
    });

    add({
      day: 1,
      description: 'Monthly rent — Ridge Apartments',
      merchant: 'Ridge Apartments',
      amount: '1800.00',
      type: 'EXPENSE',
      category: 'Housing',
      notes: 'Recurring monthly rent',
      reviewStatus: 'REVIEWED',
    });

    add({
      day: 5,
      description: 'Electricity bill (ECG)',
      merchant: 'ECG',
      amount: between(180, 320).toFixed(2),
      type: 'EXPENSE',
      category: 'Utilities',
      notes: null,
      reviewStatus: 'REVIEWED',
    });

    add({
      day: 8,
      description: 'Home broadband',
      merchant: 'Broadband Home',
      amount: '189.00',
      type: 'EXPENSE',
      category: 'Utilities',
      notes: null,
      reviewStatus: 'REVIEWED',
    });

    add({
      day: 12,
      description: 'Spotify subscription',
      merchant: 'Spotify',
      amount: '59.99',
      type: 'EXPENSE',
      category: 'Subscriptions',
      notes: null,
      reviewStatus: 'REVIEWED',
    });

    add({
      day: 15,
      description: 'Netflix subscription',
      merchant: 'Netflix',
      amount: '95.00',
      type: 'EXPENSE',
      category: 'Subscriptions',
      notes: null,
      reviewStatus: 'REVIEWED',
    });

    add({
      day: 28,
      description: 'Bank interest',
      merchant: 'Trust Bank',
      amount: between(8, 42).toFixed(2),
      type: 'INCOME',
      category: 'Interest',
      notes: null,
      reviewStatus: 'REVIEWED',
    });

    for (const day of [3, 10, 17, 24]) {
      add({
        day,
        description: `Groceries — ${pick(['ShopRite', 'Melcom', 'Koala Supermarket', 'City Market'])}`,
        merchant: pick(['ShopRite', 'Melcom', 'Koala Supermarket', 'City Market']),
        amount: between(150, 480).toFixed(2),
        type: 'EXPENSE',
        category: 'Groceries',
        notes: null,
        reviewStatus: random() > 0.85 ? 'NEEDS_REVIEW' : 'REVIEWED',
      });
    }

    for (let i = 0; i < 5; i += 1) {
      const day = 2 + i * 5 + Math.floor(random() * 3);
      add({
        day,
        description: `Transport — ${pick(['Uber ride', 'Bolt ride', 'Fuel at Goil', 'Trotro fare'])}`,
        merchant: pick(['Uber', 'Bolt', 'Goil']),
        amount: between(25, 190).toFixed(2),
        type: 'EXPENSE',
        category: 'Transport',
        notes: null,
        reviewStatus: 'REVIEWED',
      });
    }

    for (const day of [6, 13, 20, 27]) {
      add({
        day,
        description: `Dining — ${pick(['Cafe Villa', 'KFC', 'Pizza Inn', 'Chop Bar'])}`,
        merchant: pick(['Cafe Villa', 'KFC', 'Pizza Inn']),
        amount: between(45, 260).toFixed(2),
        type: 'EXPENSE',
        category: 'Dining',
        notes: null,
        reviewStatus: random() > 0.7 ? 'NEEDS_REVIEW' : 'REVIEWED',
      });
    }

    add({
      day: 18,
      description: `Shopping — ${pick(['Jumia order', 'Boutique clothing', 'Electronics store'])}`,
      merchant: pick(['Jumia', 'Boutique', 'Electronics Store']),
      amount: between(120, 850).toFixed(2),
      type: 'EXPENSE',
      category: 'Shopping',
      notes: null,
      reviewStatus: random() > 0.6 ? 'NEEDS_REVIEW' : 'REVIEWED',
    });

    if (random() > 0.4) {
      add({
        day: 21,
        description: `Entertainment — ${pick(['Cinema tickets', 'Concert', 'Game store'])}`,
        merchant: pick(['Silverbird Cinema', 'Game Store']),
        amount: between(60, 320).toFixed(2),
        type: 'EXPENSE',
        category: 'Entertainment',
        notes: null,
        reviewStatus: 'REVIEWED',
      });
    }

    if (offset % 2 === 0) {
      add({
        day: 14,
        description: 'Pharmacy — medication',
        merchant: 'HealthPlus Pharmacy',
        amount: between(60, 420).toFixed(2),
        type: 'EXPENSE',
        category: 'Healthcare',
        notes: null,
        reviewStatus: 'REVIEWED',
      });
    }

    if (offset % 3 === 0) {
      add({
        day: 9,
        description: 'Online course — Udemy',
        merchant: 'Udemy',
        amount: between(120, 320).toFixed(2),
        type: 'EXPENSE',
        category: 'Education',
        notes: null,
        reviewStatus: 'REVIEWED',
      });
    }

    add({
      day: 11,
      description: pick(['Salon visit', 'Barber', 'Laundry service']),
      merchant: pick(['Salon', 'Barber', 'Laundry']),
      amount: between(40, 180).toFixed(2),
      type: 'EXPENSE',
      category: 'Personal Care',
      notes: null,
      reviewStatus: 'REVIEWED',
    });

    if (random() > 0.5) {
      add({
        day: 23,
        description: 'Freelance project payment',
        merchant: 'Client Invoice',
        amount: between(400, 1600).toFixed(2),
        type: 'INCOME',
        category: 'Freelance',
        notes: null,
        reviewStatus: 'REVIEWED',
      });
    }

    add({
      day: 22,
      description: 'Transfer to savings account',
      merchant: 'Trust Bank',
      amount: between(300, 900).toFixed(2),
      type: 'TRANSFER',
      category: null,
      notes: 'Excluded from income and expense totals',
      reviewStatus: 'REVIEWED',
    });

    if (random() > 0.7) {
      add({
        day: 19,
        description: 'Refund — returned item',
        merchant: 'Jumia',
        amount: between(45, 220).toFixed(2),
        type: 'REFUND',
        category: 'Shopping',
        notes: null,
        reviewStatus: 'REVIEWED',
      });
    }

    // A couple of rows deliberately left uncategorized and/or unreviewed so the
    // "needs review" and "uncategorized" states are visible in the demo.
    add({
      day: 16,
      description: pick(['POS PURCHASE 88213', 'ATM WITHDRAWAL', 'CARD TXN 4410']),
      merchant: null,
      amount: between(30, 260).toFixed(2),
      type: 'EXPENSE',
      category: null,
      notes: null,
      reviewStatus: 'NEEDS_REVIEW',
    });

    if (!isCurrentMonth || random() > 0.5) {
      add({
        day: 25,
        description: pick(['Mobile money transfer', 'Unrecognised debit', 'Agent cash out']),
        merchant: null,
        amount: between(20, 180).toFixed(2),
        type: 'EXPENSE',
        category: null,
        notes: null,
        reviewStatus: 'NEEDS_REVIEW',
      });
    }
  }

  const data = rows.map((row) => ({
    workspaceId,
    transactionDate: dateOnlyToUtcDate(row.transactionDate),
    description: row.description,
    merchant: row.merchant,
    normalizedMerchant: normalizeMerchant(row.merchant),
    amount: row.amount,
    type: row.type,
    categoryId: row.category ? (categoryId.get(row.category) ?? null) : null,
    notes: row.notes,
    reviewStatus: row.reviewStatus,
    fingerprint: buildFingerprint({
      transactionDate: row.transactionDate,
      description: row.description,
      amount: row.amount,
      type: row.type,
      merchant: row.merchant,
    }),
    isSample: true,
  }));

  // Insert in batches to keep the statement size reasonable.
  let created = 0;
  for (let index = 0; index < data.length; index += 200) {
    const batch = data.slice(index, index + 200);
    const result = await prisma.transaction.createMany({ data: batch });
    created += result.count;
  }

  const budgets: { month: string; amount: string; category: string | null }[] = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const month = monthKey(addMonths(`${currentMonth}-01`, -offset));
    budgets.push({ month, amount: '3800.00', category: null });
    budgets.push({ month, amount: '1900.00', category: 'Housing' });
    budgets.push({ month, amount: '1400.00', category: 'Groceries' });
    budgets.push({ month, amount: '600.00', category: 'Transport' });
    budgets.push({ month, amount: '700.00', category: 'Dining' });
    budgets.push({ month, amount: '450.00', category: 'Utilities' });
    budgets.push({ month, amount: '250.00', category: 'Subscriptions' });
    budgets.push({ month, amount: '700.00', category: 'Shopping' });
  }

  // Budgets are inserted after any previous sample data has been cleared
  // (see `clearDemoData`). `skipDuplicates` keeps a standalone re-run safe.
  const budgetRows = budgets.map((budget) => ({
    workspaceId,
    month: monthKeyToUtcDate(budget.month),
    amount: budget.amount,
    categoryId: budget.category ? (categoryId.get(budget.category) ?? null) : null,
  }));

  const budgetResult = await prisma.budget.createMany({
    data: budgetRows,
    skipDuplicates: true,
  });

  return { transactions: created, budgets: budgetResult.count };
}

/** Convenience used by settings/tests: clear then reseed. */
export async function resetDemoData(
  workspaceId: string,
  options: SeedDemoOptions = {},
): Promise<{ transactions: number; budgets: number }> {
  await clearDemoData(workspaceId);
  return seedDemoData(workspaceId, options);
}

export { startOfMonth, endOfMonth };
