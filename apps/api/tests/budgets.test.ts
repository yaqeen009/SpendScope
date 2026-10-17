import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { resetDatabase } from './helpers/db.ts';

const app = createApp();

interface Category {
  id: string;
  name: string;
  kind: 'INCOME' | 'EXPENSE';
}

async function categoryId(name: string): Promise<string> {
  const response = await request(app).get('/api/v1/categories').expect(200);
  const match = (response.body.data as Category[]).find((category) => category.name === name);
  if (!match) throw new Error(`Category "${name}" not found`);
  return match.id;
}

async function expense(description: string, amount: string, date: string, id: string | null) {
  await request(app)
    .post('/api/v1/transactions')
    .send({ transactionDate: date, description, amount, type: 'EXPENSE', categoryId: id })
    .expect(201);
}

describe('POST /api/v1/budgets', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('creates a category budget and a total budget', async () => {
    const groceriesId = await categoryId('Groceries');

    const categoryBudget = await request(app)
      .post('/api/v1/budgets')
      .send({ month: '2026-03', amount: '800.00', categoryId: groceriesId })
      .expect(201);
    expect(categoryBudget.body.data).toMatchObject({
      month: '2026-03',
      amount: '800.00',
      categoryId: groceriesId,
    });

    const totalBudget = await request(app)
      .post('/api/v1/budgets')
      .send({ month: '2026-03', amount: '4000.00' })
      .expect(201);
    expect(totalBudget.body.data.categoryId).toBeNull();
    expect(totalBudget.body.data.category).toBeNull();
  });

  it('enforces one budget per category per month', async () => {
    const groceriesId = await categoryId('Groceries');
    await request(app)
      .post('/api/v1/budgets')
      .send({ month: '2026-03', amount: '900.00', categoryId: groceriesId })
      .expect(409);
  });

  it('enforces a single total budget per month', async () => {
    await request(app).post('/api/v1/budgets').send({ month: '2026-03', amount: '5000.00' }).expect(409);
  });

  it('rejects a zero amount', async () => {
    await request(app).post('/api/v1/budgets').send({ month: '2026-04', amount: '0.00' }).expect(400);
  });

  it('refuses budgets on income categories', async () => {
    const salaryId = await categoryId('Salary');
    const response = await request(app)
      .post('/api/v1/budgets')
      .send({ month: '2026-04', amount: '100.00', categoryId: salaryId })
      .expect(400);
    expect(response.body.error.message).toMatch(/expense categories/i);
  });
});

describe('GET /api/v1/budgets', () => {
  beforeAll(async () => {
    await resetDatabase();
    const groceriesId = await categoryId('Groceries');
    await request(app)
      .post('/api/v1/budgets')
      .send({ month: '2026-03', amount: '800.00', categoryId: groceriesId })
      .expect(201);
    await request(app).post('/api/v1/budgets').send({ month: '2026-03', amount: '4000.00' }).expect(201);
    await request(app).post('/api/v1/budgets').send({ month: '2026-04', amount: '4200.00' }).expect(201);
  });

  it('filters by month', async () => {
    const response = await request(app).get('/api/v1/budgets?month=2026-03').expect(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data.every((budget: { month: string }) => budget.month === '2026-03')).toBe(true);
  });

  it('filters by month range', async () => {
    const response = await request(app).get('/api/v1/budgets?from=2026-04&to=2026-04').expect(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].month).toBe('2026-04');
  });
});

describe('GET /api/v1/budgets/progress/:month', () => {
  beforeAll(async () => {
    await resetDatabase();
    const groceriesId = await categoryId('Groceries');
    const transportId = await categoryId('Transport');

    await request(app).post('/api/v1/budgets').send({ month: '2026-03', amount: '1000.00' }).expect(201);
    await request(app)
      .post('/api/v1/budgets')
      .send({ month: '2026-03', amount: '500.00', categoryId: groceriesId })
      .expect(201);
    await request(app)
      .post('/api/v1/budgets')
      .send({ month: '2026-03', amount: '200.00', categoryId: transportId })
      .expect(201);

    await expense('Groceries', '600.00', '2026-03-05', groceriesId);
    await expense('Fuel', '250.00', '2026-03-06', transportId);
    await expense('Uncategorised splurge', '100.00', '2026-03-07', null);
    // Outside the month — must not count.
    await expense('April groceries', '999.00', '2026-04-02', groceriesId);
  });

  it('computes spend, remaining and state per budget', async () => {
    const response = await request(app).get('/api/v1/budgets/progress/2026-03').expect(200);
    const { items, total } = response.body.data as {
      items: {
        categoryName: string | null;
        budgetAmount: string;
        spent: string;
        remaining: string;
        state: string;
        isTotalBudget: boolean;
      }[];
      total: { spent: string; state: string } | null;
    };

    const groceries = items.find((item) => item.categoryName === 'Groceries');
    expect(groceries).toMatchObject({ budgetAmount: '500.00', spent: '600.00', state: 'exceeded' });

    const transport = items.find((item) => item.categoryName === 'Transport');
    expect(transport).toMatchObject({ budgetAmount: '200.00', spent: '250.00', state: 'exceeded' });

    // Total expense budget includes every expense in the month, categorised or not.
    const totalItem = items.find((item) => item.isTotalBudget);
    expect(totalItem).toMatchObject({ budgetAmount: '1000.00', spent: '950.00' });
    expect(total).toMatchObject({ spent: '950.00', state: 'warning' });
  });

  it('rejects a malformed month', async () => {
    await request(app).get('/api/v1/budgets/progress/2026-13').expect(400);
  });

  it('returns an empty result for a month with no budgets', async () => {
    const response = await request(app).get('/api/v1/budgets/progress/2025-01').expect(200);
    expect(response.body.data.items).toHaveLength(0);
    expect(response.body.data.total).toBeNull();
  });
});

describe('PATCH/DELETE /api/v1/budgets/:id', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('updates and deletes a budget', async () => {
    const created = await request(app)
      .post('/api/v1/budgets')
      .send({ month: '2026-05', amount: '100.00' })
      .expect(201);

    const updated = await request(app)
      .patch(`/api/v1/budgets/${created.body.data.id}`)
      .send({ amount: '150.00' })
      .expect(200);
    expect(updated.body.data.amount).toBe('150.00');

    await request(app).delete(`/api/v1/budgets/${created.body.data.id}`).expect(204);
    await request(app).get(`/api/v1/budgets/${created.body.data.id}`).expect(404);
  });
});
