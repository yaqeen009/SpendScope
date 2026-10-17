import { api } from './helpers/api.ts';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { resetDatabase } from './helpers/db.ts';

/**
 * Financial integrity: refund linkage and manual transfer pairing.
 *
 * These specs assert real money arithmetic through the API: a refund must
 * reverse a specific expense, must never over-refund it, and must reduce the
 * correct category's spend. Transfers must never appear in income or expenses.
 */

const app = createApp();

const RANGE = 'period=custom&from=2026-03-01&to=2026-03-31';

interface CategoryRef {
  id: string;
  name: string;
  kind: 'INCOME' | 'EXPENSE';
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
    .send({ transactionDate: '2026-03-05', description: 'Row', amount: '100.00', type: 'EXPENSE', ...body });
  return { status: response.status, body: response.body };
}

async function createOk(body: Record<string, unknown>) {
  const result = await create(body);
  if (result.status !== 201) throw new Error(`create failed: ${JSON.stringify(result.body)}`);
  return result.body.data;
}

async function summary() {
  const response = await api(app).get(`/api/v1/analytics/summary?${RANGE}`).expect(200);
  return response.body.data.current as { income: string; expenses: string; net: string };
}

describe('refund linkage', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('rejects a link to a transaction that does not exist', async () => {
    const response = await create({
      type: 'REFUND',
      amount: '10.00',
      refundOfTransactionId: '00000000-0000-4000-8000-000000000000',
    });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('only allows REFUND rows to carry a link', async () => {
    const groceries = await categoryId('Groceries');
    const expense = await createOk({ categoryId: groceries, amount: '80.00' });

    const response = await create({
      type: 'EXPENSE',
      amount: '10.00',
      categoryId: groceries,
      refundOfTransactionId: expense.id,
    });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('Only REFUND transactions');
  });

  it('refuses to link a refund to a non-expense original', async () => {
    const salary = await categoryId('Salary');
    const income = await createOk({ type: 'INCOME', amount: '900.00', categoryId: salary });

    const response = await create({ type: 'REFUND', amount: '10.00', refundOfTransactionId: income.id });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('EXPENSE');
  });

  it('inherits the original expense category and reduces its spend', async () => {
    const groceries = await categoryId('Groceries');
    const before = await summary();

    const expense = await createOk({ categoryId: groceries, amount: '120.00' });

    // No categoryId supplied: it must be inherited from the original.
    const refund = await createOk({ type: 'REFUND', amount: '20.00', refundOfTransactionId: expense.id });
    expect(refund.categoryId).toBe(groceries);
    expect(refund.refundOfTransactionId).toBe(expense.id);

    const totals = await summary();
    // The expense adds 120.00 and the refund removes 20.00.
    expect(Number(totals.expenses)).toBeCloseTo(Number(before.expenses) + 100, 2);

    const detail = await api(app).get(`/api/v1/transactions/${expense.id}`).expect(200);
    expect(detail.body.data.refundedAmount).toBe('20.00');
  });

  it('rejects a refund that names a different category', async () => {
    const groceries = await categoryId('Groceries');
    const transport = await categoryId('Transport');
    const expense = await createOk({ categoryId: groceries, amount: '50.00' });

    // "Transport" must exist for the request to reach the refund rule.
    expect(transport).not.toBe(groceries);

    const response = await create({
      type: 'REFUND',
      amount: '5.00',
      categoryId: transport,
      refundOfTransactionId: expense.id,
    });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('same category');
  });

  it('accepts repeated partial refunds but caps the total at the original amount', async () => {
    const groceries = await categoryId('Groceries');
    const expense = await createOk({ categoryId: groceries, amount: '100.00' });

    await createOk({ type: 'REFUND', amount: '30.00', refundOfTransactionId: expense.id });
    await createOk({ type: 'REFUND', amount: '40.00', refundOfTransactionId: expense.id });

    const over = await create({ type: 'REFUND', amount: '30.01', refundOfTransactionId: expense.id });
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe('BAD_REQUEST');
    expect(over.body.error.details).toMatchObject({
      originalAmount: '100.00',
      alreadyRefunded: '70.00',
      remaining: '30.00',
    });

    // Exactly the remaining amount is still accepted.
    await createOk({ type: 'REFUND', amount: '30.00', refundOfTransactionId: expense.id });

    const detail = await api(app).get(`/api/v1/transactions/${expense.id}`).expect(200);
    expect(detail.body.data.refundedAmount).toBe('100.00');
  });

  it('treats an uncategorized expense refund as uncategorized', async () => {
    const expense = await createOk({ amount: '40.00' });
    const refund = await createOk({ type: 'REFUND', amount: '10.00', refundOfTransactionId: expense.id });
    expect(refund.categoryId).toBeNull();
  });

  it('refuses to make an uncategorized refund categorized', async () => {
    const groceries = await categoryId('Groceries');
    const expense = await createOk({ amount: '40.00' });

    const response = await create({
      type: 'REFUND',
      amount: '10.00',
      categoryId: groceries,
      refundOfTransactionId: expense.id,
    });
    expect(response.status).toBe(400);
  });

  it('keeps linked refunds aligned when the original changes category', async () => {
    const groceries = await categoryId('Groceries');
    const transport = await categoryId('Transport');
    const expense = await createOk({ categoryId: groceries, amount: '60.00' });
    const refund = await createOk({ type: 'REFUND', amount: '10.00', refundOfTransactionId: expense.id });

    await api(app).patch(`/api/v1/transactions/${expense.id}`).send({ categoryId: transport }).expect(200);

    const updated = await api(app).get(`/api/v1/transactions/${refund.id}`).expect(200);
    expect(updated.body.data.categoryId).toBe(transport);
  });

  it('blocks turning a refunded expense into another type', async () => {
    const groceries = await categoryId('Groceries');
    const expense = await createOk({ categoryId: groceries, amount: '60.00' });
    await createOk({ type: 'REFUND', amount: '10.00', refundOfTransactionId: expense.id });

    const response = await api(app)
      .patch(`/api/v1/transactions/${expense.id}`)
      .send({ type: 'INCOME', categoryId: null });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('linked refunds');
  });

  it('blocks shrinking a refunded expense below the refunded total', async () => {
    const groceries = await categoryId('Groceries');
    const expense = await createOk({ categoryId: groceries, amount: '60.00' });
    await createOk({ type: 'REFUND', amount: '25.00', refundOfTransactionId: expense.id });

    const response = await api(app).patch(`/api/v1/transactions/${expense.id}`).send({ amount: '20.00' });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('already refunded');
  });

  it('allows an update to remove the refund link', async () => {
    const groceries = await categoryId('Groceries');
    const expense = await createOk({ categoryId: groceries, amount: '60.00' });
    const refund = await createOk({ type: 'REFUND', amount: '10.00', refundOfTransactionId: expense.id });

    const response = await api(app)
      .patch(`/api/v1/transactions/${refund.id}`)
      .send({ refundOfTransactionId: null })
      .expect(200);
    expect(response.body.data.refundOfTransactionId).toBeNull();

    const detail = await api(app).get(`/api/v1/transactions/${expense.id}`).expect(200);
    expect(detail.body.data.refundedAmount).toBe('0.00');
  });

  it('restores the refundable amount when a refund is deleted', async () => {
    const groceries = await categoryId('Groceries');
    const expense = await createOk({ categoryId: groceries, amount: '30.00' });
    const refund = await createOk({ type: 'REFUND', amount: '30.00', refundOfTransactionId: expense.id });

    await api(app).delete(`/api/v1/transactions/${refund.id}`).expect(204);

    // The full amount is refundable again.
    await createOk({ type: 'REFUND', amount: '30.00', refundOfTransactionId: expense.id });
  });
});

describe('transfer pairing', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('pairs two equal transfers and reports the shared group', async () => {
    const a = await createOk({ type: 'TRANSFER', amount: '250.00', description: 'To savings' });
    const b = await createOk({
      type: 'TRANSFER',
      amount: '250.00',
      description: 'From current',
      transactionDate: '2026-03-07',
    });

    const response = await api(app)
      .post(`/api/v1/transactions/${a.id}/transfer`)
      .send({ counterpartId: b.id })
      .expect(200);

    const groupId = response.body.data.transferGroupId as string;
    expect(typeof groupId).toBe('string');

    const first = await api(app).get(`/api/v1/transactions/${a.id}`).expect(200);
    const second = await api(app).get(`/api/v1/transactions/${b.id}`).expect(200);
    expect(first.body.data.transferGroupId).toBe(groupId);
    expect(second.body.data.transferGroupId).toBe(groupId);
  });

  it('rejects pairing a transaction with itself', async () => {
    const a = await createOk({ type: 'TRANSFER', amount: '10.00' });
    const response = await api(app).post(`/api/v1/transactions/${a.id}/transfer`).send({ counterpartId: a.id });
    expect(response.status).toBe(400);
  });

  it('rejects a non-transfer counterpart', async () => {
    const transfer = await createOk({ type: 'TRANSFER', amount: '10.00' });
    const expense = await createOk({ amount: '10.00' });

    const response = await api(app)
      .post(`/api/v1/transactions/${transfer.id}/transfer`)
      .send({ counterpartId: expense.id });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('TRANSFER');
  });

  it('rejects unequal amounts', async () => {
    const a = await createOk({ type: 'TRANSFER', amount: '10.00' });
    const b = await createOk({ type: 'TRANSFER', amount: '11.00' });

    const response = await api(app).post(`/api/v1/transactions/${a.id}/transfer`).send({ counterpartId: b.id });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('same amount');
  });

  it('rejects transfers more than five days apart', async () => {
    const a = await createOk({ type: 'TRANSFER', amount: '10.00', transactionDate: '2026-03-01' });
    const b = await createOk({ type: 'TRANSFER', amount: '10.00', transactionDate: '2026-03-09' });

    const response = await api(app).post(`/api/v1/transactions/${a.id}/transfer`).send({ counterpartId: b.id });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('within 5 days');
  });

  it('refuses to re-pair an already paired row', async () => {
    const a = await createOk({ type: 'TRANSFER', amount: '70.00' });
    const b = await createOk({ type: 'TRANSFER', amount: '70.00' });
    const c = await createOk({ type: 'TRANSFER', amount: '70.00' });

    await api(app).post(`/api/v1/transactions/${a.id}/transfer`).send({ counterpartId: b.id }).expect(200);

    const response = await api(app).post(`/api/v1/transactions/${a.id}/transfer`).send({ counterpartId: c.id });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('never counts transfers as income or expenses', async () => {
    const before = await summary();

    const a = await createOk({ type: 'TRANSFER', amount: '500.00', transactionDate: '2026-03-20' });
    const b = await createOk({ type: 'TRANSFER', amount: '500.00', transactionDate: '2026-03-20' });

    const after = await summary();
    // Transfers are counted as transactions but never as income or expenses.
    expect(after.income).toBe(before.income);
    expect(after.expenses).toBe(before.expenses);

    // Pairing them changes nothing either.
    await api(app).post(`/api/v1/transactions/${a.id}/transfer`).send({ counterpartId: b.id }).expect(200);
    const paired = await summary();
    expect(paired.income).toBe(before.income);
    expect(paired.expenses).toBe(before.expenses);
  });

  it('suggests an explainable pair without changing anything', async () => {
    const a = await createOk({ type: 'TRANSFER', amount: '321.00', transactionDate: '2026-03-11' });
    const b = await createOk({ type: 'TRANSFER', amount: '321.00', transactionDate: '2026-03-12' });

    const response = await api(app).get('/api/v1/transactions/transfer-suggestions').expect(200);
    const suggestions = response.body.data as { a: { id: string }; b: { id: string }; dayGap: number; reason: string }[];
    const match = suggestions.find(
      (item) => [item.a.id, item.b.id].includes(a.id) && [item.a.id, item.b.id].includes(b.id),
    );
    expect(match).toBeDefined();
    expect(match?.dayGap).toBe(1);
    expect(match?.reason).toContain('321.00');

    // Suggestions are advisory: the rows stay unpaired.
    const detail = await api(app).get(`/api/v1/transactions/${a.id}`).expect(200);
    expect(detail.body.data.transferGroupId).toBeNull();
  });

  it('unlinks both sides of a movement', async () => {
    const a = await createOk({ type: 'TRANSFER', amount: '88.00' });
    const b = await createOk({ type: 'TRANSFER', amount: '88.00' });
    await api(app).post(`/api/v1/transactions/${a.id}/transfer`).send({ counterpartId: b.id }).expect(200);

    const response = await api(app).delete(`/api/v1/transactions/${a.id}/transfer`).expect(200);
    expect(response.body.data.unlinked).toBe(2);

    const second = await api(app).get(`/api/v1/transactions/${b.id}`).expect(200);
    expect(second.body.data.transferGroupId).toBeNull();
  });

  it('rejects unlinking a row that is not paired', async () => {
    const a = await createOk({ type: 'TRANSFER', amount: '12.00' });
    const response = await api(app).delete(`/api/v1/transactions/${a.id}/transfer`);
    expect(response.status).toBe(400);
  });

  it('unpairs the surviving side when one side is deleted', async () => {
    const a = await createOk({ type: 'TRANSFER', amount: '15.00' });
    const b = await createOk({ type: 'TRANSFER', amount: '15.00' });
    await api(app).post(`/api/v1/transactions/${a.id}/transfer`).send({ counterpartId: b.id }).expect(200);

    await api(app).delete(`/api/v1/transactions/${a.id}`).expect(204);

    const second = await api(app).get(`/api/v1/transactions/${b.id}`).expect(200);
    expect(second.body.data.transferGroupId).toBeNull();
  });
});
