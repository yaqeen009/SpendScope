import { api } from './helpers/api.ts';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { resetDatabase } from './helpers/db.ts';

const app = createApp();

const RANGE = 'period=custom&from=2026-03-01&to=2026-03-31';

interface Category {
  id: string;
  name: string;
}

async function categoryId(name: string): Promise<string> {
  const response = await api(app).get('/api/v1/categories').expect(200);
  const match = (response.body.data as Category[]).find((category) => category.name === name);
  if (!match) throw new Error(`Category "${name}" not found`);
  return match.id;
}

async function addTransaction(body: Record<string, unknown>) {
  await api(app).post('/api/v1/transactions').send(body).expect(201);
}

describe('analytics over a fixed period', () => {
  beforeAll(async () => {
    await resetDatabase();
    const groceries = await categoryId('Groceries');
    const salary = await categoryId('Salary');
    const subscriptions = await categoryId('Subscriptions');

    await addTransaction({
      transactionDate: '2026-03-01',
      description: 'Supermarket shopping',
      amount: '312.45',
      type: 'EXPENSE',
      categoryId: groceries,
    });
    await addTransaction({
      transactionDate: '2026-03-02',
      description: 'Monthly salary',
      amount: '5000.00',
      type: 'INCOME',
      categoryId: salary,
    });
    await addTransaction({
      transactionDate: '2026-03-03',
      description: 'Netflix subscription',
      amount: '95.00',
      type: 'EXPENSE',
      categoryId: subscriptions,
    });
    await addTransaction({
      transactionDate: '2026-03-05',
      description: 'Move to savings',
      amount: '500.00',
      type: 'TRANSFER',
    });
    await addTransaction({
      transactionDate: '2026-03-10',
      description: 'Returned item refund',
      amount: '50.00',
      type: 'REFUND',
      categoryId: groceries,
    });
    await addTransaction({
      transactionDate: '2026-03-20',
      description: 'Loose change spend',
      amount: '100.00',
      type: 'EXPENSE',
    });
  });

  it('summarises income, expenses, refunds and transfers correctly', async () => {
    const response = await api(app).get(`/api/v1/analytics/summary?${RANGE}`).expect(200);
    const { current, period } = response.body.data;

    expect(period).toMatchObject({ start: '2026-03-01', end: '2026-03-31' });
    // expenses = 312.45 + 95.00 + 100.00 − 50.00 refund
    expect(current).toMatchObject({
      income: '5000.00',
      expenses: '457.45',
      net: '4542.55',
      transactionCount: 6,
      uncategorizedExpenseTotal: '100.00',
      uncategorizedCount: 1,
    });
    expect(current.savingsRate).toBeCloseTo(4542.55 / 5000, 6);
  });

  it('breaks down spend by category and nets refunds out', async () => {
    const response = await api(app).get(`/api/v1/analytics/categories?${RANGE}`).expect(200);
    const { total, items } = response.body.data as {
      total: string;
      items: { name: string; total: string; kind: string; share: number }[];
    };

    expect(total).toBe('457.45');
    const byName = Object.fromEntries(items.map((item) => [item.name, item]));
    expect(byName.Groceries?.total).toBe('262.45');
    expect(byName.Subscriptions?.total).toBe('95.00');
    expect(byName.Uncategorized?.total).toBe('100.00');
    // Transfers never appear in the breakdown.
    expect(items.find((item) => item.name === 'Uncategorized')?.kind).toBe('EXPENSE');
  });

  it('builds a daily time series covering the whole range', async () => {
    const response = await api(app).get(`/api/v1/analytics/time-series?${RANGE}`).expect(200);
    const { granularity, points, range } = response.body.data;

    expect(granularity).toBe('day');
    expect(range).toEqual({ start: '2026-03-01', end: '2026-03-31' });
    expect(points).toHaveLength(31);

    const firstDay = points.find((point: { bucket: string }) => point.bucket === '2026-03-01');
    expect(firstDay).toMatchObject({ income: '0.00', expenses: '312.45' });

    const salaryDay = points.find((point: { bucket: string }) => point.bucket === '2026-03-02');
    expect(salaryDay.income).toBe('5000.00');

    const summedExpenses = points
      .reduce((total: number, point: { expenses: string }) => total + Number(point.expenses), 0);
    expect(summedExpenses).toBeCloseTo(457.45, 2);
  });

  it('produces at least six monthly trend points', async () => {
    const response = await api(app).get(`/api/v1/analytics/monthly-trend?${RANGE}`).expect(200);
    const months = response.body.data.months as { month: string }[];
    expect(months.length).toBeGreaterThanOrEqual(6);
    expect(months[months.length - 1]?.month).toBe('2026-03');
  });

  it('returns the largest expenses without transfers or refunds', async () => {
    const response = await api(app).get(`/api/v1/analytics/largest-expenses?${RANGE}`).expect(200);
    const rows = response.body.data as { type: string; amount: string }[];
    expect(rows.every((row) => row.type === 'EXPENSE')).toBe(true);
    expect(rows[0]?.amount).toBe('312.45');
  });

  it('returns recent transactions including transfers', async () => {
    const response = await api(app)
      .get(`/api/v1/analytics/recent-transactions?${RANGE}&recentLimit=3`)
      .expect(200);
    expect(response.body.data).toHaveLength(3);
    expect(response.body.data[0]?.transactionDate).toBe('2026-03-20');
  });

  it('assembles the dashboard payload', async () => {
    const response = await api(app).get(`/api/v1/analytics/dashboard?${RANGE}`).expect(200);
    const dashboard = response.body.data;

    expect(dashboard.empty).toBe(false);
    expect(dashboard.summary.current.expenses).toBe('457.45');
    expect(dashboard.categoryBreakdown.items.length).toBeGreaterThan(0);
    expect(Array.isArray(dashboard.insights.insights)).toBe(true);
    expect(dashboard.insights.insights.some((insight: { id: string }) => insight.id === 'uncategorized')).toBe(true);
  });

  it('reports empty=true on a database with no transactions', async () => {
    await resetDatabase();
    const response = await api(app).get(`/api/v1/analytics/dashboard?${RANGE}`).expect(200);
    expect(response.body.data.empty).toBe(true);
    expect(response.body.data.summary.current).toMatchObject({ income: '0.00', expenses: '0.00' });
  });
});
