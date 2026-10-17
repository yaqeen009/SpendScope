import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { resetDatabase } from './helpers/db.ts';

const app = createApp();

interface CategoryRef {
  id: string;
  name: string;
  kind: 'INCOME' | 'EXPENSE';
}

async function categoryId(name: string): Promise<string> {
  const response = await request(app).get('/api/v1/categories').expect(200);
  const match = (response.body.data as CategoryRef[]).find((category) => category.name === name);
  if (!match) throw new Error(`Category "${name}" not found`);
  return match.id;
}

async function createSample(overrides: Record<string, unknown> = {}) {
  const response = await request(app)
    .post('/api/v1/transactions')
    .send({
      transactionDate: '2026-03-01',
      description: 'Supermarket shopping',
      amount: '312.45',
      type: 'EXPENSE',
      ...overrides,
    })
    .expect(201);
  return response.body.data;
}

describe('POST /api/v1/transactions', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('creates a transaction with a decimal-safe amount string', async () => {
    const created = await createSample({ merchant: 'ShopRite', notes: 'Weekly shop' });

    expect(created).toMatchObject({
      transactionDate: '2026-03-01',
      description: 'Supermarket shopping',
      amount: '312.45',
      type: 'EXPENSE',
      merchant: 'ShopRite',
      categoryId: null,
      reviewStatus: 'NEEDS_REVIEW',
      isSample: false,
    });
    expect(typeof created.id).toBe('string');
  });

  it('rejects an invalid body with structured issues', async () => {
    const response = await request(app)
      .post('/api/v1/transactions')
      .send({ transactionDate: '2026-13-40', description: '', amount: '-5', type: 'NOPE' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    const paths = (response.body.error.details as { path: string }[]).map((issue) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(['transactionDate', 'description', 'amount', 'type']));
  });

  it('rejects an amount with more than two decimals', async () => {
    await request(app)
      .post('/api/v1/transactions')
      .send({ transactionDate: '2026-03-01', description: 'Rounding', amount: '12.345', type: 'EXPENSE' })
      .expect(400);
  });

  it('rejects a category whose kind does not match the transaction type', async () => {
    const salaryId = await categoryId('Salary');
    const response = await request(app)
      .post('/api/v1/transactions')
      .send({
        transactionDate: '2026-03-01',
        description: 'Pretend expense',
        amount: '10.00',
        type: 'EXPENSE',
        categoryId: salaryId,
      })
      .expect(400);

    expect(response.body.error.message).toMatch(/income category/i);
  });

  it('refuses to categorise a transfer', async () => {
    const groceriesId = await categoryId('Groceries');
    const response = await request(app)
      .post('/api/v1/transactions')
      .send({
        transactionDate: '2026-03-01',
        description: 'Move money',
        amount: '500.00',
        type: 'TRANSFER',
        categoryId: groceriesId,
      })
      .expect(400);

    expect(response.body.error.message).toMatch(/transfer/i);
  });

  it('returns 404 for an unknown category', async () => {
    await request(app)
      .post('/api/v1/transactions')
      .send({
        transactionDate: '2026-03-01',
        description: 'Ghost category',
        amount: '10.00',
        type: 'EXPENSE',
        categoryId: '00000000-0000-4000-8000-000000000000',
      })
      .expect(404);
  });
});

describe('GET /api/v1/transactions', () => {
  beforeAll(async () => {
    await resetDatabase();
    const groceriesId = await categoryId('Groceries');
    await createSample({ description: 'Groceries run', amount: '120.00', categoryId: groceriesId });
    await createSample({ description: 'Salary March', amount: '5000.00', type: 'INCOME' });
    await createSample({ description: 'Fuel', amount: '180.00', merchant: 'Goil' });
  });

  it('paginates with a stable envelope', async () => {
    const response = await request(app).get('/api/v1/transactions').expect(200);
    expect(response.body).toMatchObject({ page: 1, pageSize: 25, total: 3, totalPages: 1 });
    expect(response.body.data).toHaveLength(3);
  });

  it('filters by type and category', async () => {
    const income = await request(app).get('/api/v1/transactions?type=INCOME').expect(200);
    expect(income.body.data).toHaveLength(1);
    expect(income.body.data[0].description).toBe('Salary March');

    const uncategorized = await request(app)
      .get('/api/v1/transactions?categoryId=uncategorized')
      .expect(200);
    expect(uncategorized.body.data).toHaveLength(2);
  });

  it('searches descriptions and merchants case-insensitively', async () => {
    const response = await request(app).get('/api/v1/transactions?search=goil').expect(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].description).toBe('Fuel');
  });

  it('filters by amount range', async () => {
    const response = await request(app)
      .get('/api/v1/transactions?minAmount=100&maxAmount=200')
      .expect(200);
    expect(response.body.data).toHaveLength(2);
  });

  it('rejects a bad page size', async () => {
    await request(app).get('/api/v1/transactions?pageSize=1000').expect(400);
  });
});

describe('GET/PATCH/DELETE /api/v1/transactions/:id', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('reads, updates and deletes a transaction', async () => {
    const created = await createSample();

    const read = await request(app).get(`/api/v1/transactions/${created.id}`).expect(200);
    expect(read.body.data.id).toBe(created.id);

    const updated = await request(app)
      .patch(`/api/v1/transactions/${created.id}`)
      .send({ amount: '99.99', reviewStatus: 'REVIEWED' })
      .expect(200);
    expect(updated.body.data).toMatchObject({ amount: '99.99', reviewStatus: 'REVIEWED' });

    await request(app).delete(`/api/v1/transactions/${created.id}`).expect(204);
    await request(app).get(`/api/v1/transactions/${created.id}`).expect(404);
  });

  it('rejects an empty patch body', async () => {
    const created = await createSample();
    await request(app).patch(`/api/v1/transactions/${created.id}`).send({}).expect(400);
  });

  it('rejects a malformed id', async () => {
    await request(app).get('/api/v1/transactions/not-a-uuid').expect(400);
  });

  it('returns 404 for a valid but unknown id', async () => {
    await request(app)
      .get('/api/v1/transactions/00000000-0000-4000-8000-000000000000')
      .expect(404);
  });
});
