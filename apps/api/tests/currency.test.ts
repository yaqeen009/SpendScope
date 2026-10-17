import { api } from './helpers/api.ts';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { resetDatabase } from './helpers/db.ts';

/**
 * Currency handling.
 *
 * SpendScope performs no conversion. The contract these specs pin down is:
 *
 *  - a base-currency row is stored as `currency = null` and is part of totals,
 *  - a foreign-currency row is stored with its own code and is **excluded** from
 *    every aggregated total, and the summary says so,
 *  - money that belongs together (a refund and its expense, the two sides of a
 *    transfer) must be in one currency.
 */

const app = createApp();

const RANGE = 'period=custom&from=2026-07-01&to=2026-07-31';

interface CategoryRef {
  id: string;
  name: string;
}

async function categoryId(name: string): Promise<string> {
  const response = await api(app).get('/api/v1/categories').expect(200);
  const match = (response.body.data as CategoryRef[]).find((category) => category.name === name);
  if (!match) throw new Error(`Category "${name}" not found`);
  return match.id;
}

async function create(body: Record<string, unknown>) {
  const response = await api(app)
    .post('/api/v1/transactions')
    .send({ transactionDate: '2026-07-05', description: 'Row', amount: '100.00', type: 'EXPENSE', ...body });
  return { status: response.status, body: response.body };
}

async function createOk(body: Record<string, unknown>) {
  const result = await create(body);
  if (result.status !== 201) throw new Error(`create failed: ${JSON.stringify(result.body)}`);
  return result.body.data;
}

async function metrics() {
  const response = await api(app).get(`/api/v1/analytics/summary?${RANGE}`).expect(200);
  return response.body.data.current as {
    expenses: string;
    income: string;
    transactionCount: number;
    foreignCurrency: { count: number; currencies: string[]; totals: { currency: string; income: string; expenses: string; count: number }[] };
  };
}

describe('transaction currency', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('normalises the base currency to null and counts it in totals', async () => {
    const before = await metrics();

    const explicitBase = await createOk({ amount: '10.00', currency: 'GHS' });
    const omitted = await createOk({ amount: '20.00' });

    expect(explicitBase.currency).toBeNull();
    expect(omitted.currency).toBeNull();

    const after = await metrics();
    expect(Number(after.expenses)).toBeCloseTo(Number(before.expenses) + 30, 2);
    expect(after.foreignCurrency.count).toBe(0);
  });

  it('rejects a currency that is not supported', async () => {
    const response = await create({ currency: 'XYZ', amount: '5.00' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('stores a foreign currency and excludes it from every total', async () => {
    const before = await metrics();

    const usd = await createOk({ amount: '400.00', currency: 'USD' });
    expect(usd.currency).toBe('USD');

    const after = await metrics();
    // The base-currency totals are unchanged...
    expect(after.expenses).toBe(before.expenses);
    expect(after.income).toBe(before.income);
    expect(after.transactionCount).toBe(before.transactionCount);
    // ...and the excluded row is reported instead.
    expect(after.foreignCurrency.count).toBe(1);
    expect(after.foreignCurrency.currencies).toEqual(['USD']);
    expect(after.foreignCurrency.totals).toEqual([{ currency: 'USD', income: '0.00', expenses: '400.00', count: 1 }]);

    // The row itself is present and carries its currency.
    const detail = await api(app).get(`/api/v1/transactions/${usd.id}`).expect(200);
    expect(detail.body.data).toMatchObject({ amount: '400.00', currency: 'USD' });
  });

  it('filters the transaction list by currency, including base as a literal', async () => {
    const base = await api(app).get('/api/v1/transactions?currency=base').expect(200);
    expect((base.body.data as { currency: string | null }[]).every((row) => row.currency === null)).toBe(true);

    const foreign = await api(app).get('/api/v1/transactions?currency=USD').expect(200);
    expect((foreign.body.data as { currency: string | null }[]).length).toBeGreaterThan(0);
    expect((foreign.body.data as { currency: string | null }[]).every((row) => row.currency === 'USD')).toBe(true);
  });

  it('labels the resolved currency in the CSV export', async () => {
    const response = await api(app).get('/api/v1/exports/transactions.csv?currency=USD').expect(200);
    expect(response.text).toContain('currency');
    expect(response.text).toContain('USD');

    const base = await api(app).get('/api/v1/exports/transactions.csv?currency=base').expect(200);
    // A base-currency row is labelled with the workspace currency, never blank.
    expect(base.text).toContain('GHS');
  });

  it('keeps the currency in a backup and through a restore', async () => {
    const backup = await api(app).get('/api/v1/exports/backup.json').expect(200);
    const foreign = (backup.body.transactions as { currency: string | null }[]).find((row) => row.currency === 'USD');
    expect(foreign).toBeDefined();

    // A restore into the same workspace is idempotent-ish: replace then compare.
    await api(app)
      .post('/api/v1/exports/restore')
      .send({ mode: 'replace', confirm: 'RESTORE', backup: backup.body })
      .expect(200);

    const restored = await api(app).get('/api/v1/transactions?currency=USD').expect(200);
    expect((restored.body.data as { currency: string | null }[]).length).toBeGreaterThan(0);
  });
});

describe('currency consistency', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('makes a refund inherit the original expense currency', async () => {
    const groceries = await categoryId('Groceries');
    const expense = await createOk({ amount: '80.00', currency: 'USD', categoryId: groceries });

    const refund = await createOk({ type: 'REFUND', amount: '20.00', refundOfTransactionId: expense.id });
    expect(refund.currency).toBe('USD');
  });

  it('refuses a refund in a different currency from the expense', async () => {
    const groceries = await categoryId('Groceries');
    const expense = await createOk({ amount: '80.00', currency: 'USD', categoryId: groceries });

    const response = await create({
      type: 'REFUND',
      amount: '20.00',
      currency: 'GHS',
      refundOfTransactionId: expense.id,
    });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('same currency');
  });

  it('refuses to change the currency of an expense that has linked refunds', async () => {
    const groceries = await categoryId('Groceries');
    const expense = await createOk({ amount: '80.00', currency: 'USD', categoryId: groceries });
    await createOk({ type: 'REFUND', amount: '10.00', refundOfTransactionId: expense.id });

    const response = await api(app)
      .patch(`/api/v1/transactions/${expense.id}`)
      .send({ currency: 'GHS' });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('linked refunds');
  });

  it('refuses to pair two transfers in different currencies', async () => {
    const a = await createOk({ type: 'TRANSFER', amount: '250.00' });
    const b = await createOk({ type: 'TRANSFER', amount: '250.00', currency: 'USD' });

    const response = await api(app)
      .post(`/api/v1/transactions/${a.id}/transfer`)
      .send({ counterpartId: b.id });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('same currency');
  });

  it('never suggests a cross-currency transfer pair', async () => {
    const response = await api(app).get('/api/v1/transactions/transfer-suggestions').expect(200);
    const suggestions = response.body.data as { a: { currency: string | null }; b: { currency: string | null } }[];
    expect(
      suggestions.every((item) => (item.a.currency ?? null) === (item.b.currency ?? null)),
    ).toBe(true);
  });
});
