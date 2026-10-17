import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { resetDatabase } from './helpers/db.ts';

const app = createApp();

interface Category {
  id: string;
  name: string;
  kind: 'INCOME' | 'EXPENSE';
  color: string | null;
  isDefault: boolean;
  transactionCount: number;
  lifetimeTotal: string;
}

async function listCategories(): Promise<Category[]> {
  const response = await request(app).get('/api/v1/categories').expect(200);
  return response.body.data as Category[];
}

async function findByName(name: string): Promise<Category> {
  const match = (await listCategories()).find((category) => category.name === name);
  if (!match) throw new Error(`Category "${name}" not found`);
  return match;
}

describe('GET /api/v1/categories', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('returns the seeded default catalogue', async () => {
    const categories = await listCategories();
    expect(categories).toHaveLength(17);
    expect(categories.filter((category) => category.kind === 'INCOME')).toHaveLength(5);
    expect(categories.filter((category) => category.kind === 'EXPENSE')).toHaveLength(12);
    expect(categories.every((category) => category.isDefault)).toBe(true);
  });

  it('reports per-category lifetime totals', async () => {
    const groceries = await findByName('Groceries');

    await request(app)
      .post('/api/v1/transactions')
      .send({
        transactionDate: '2026-03-01',
        description: 'Shop',
        amount: '200.00',
        type: 'EXPENSE',
        categoryId: groceries.id,
      })
      .expect(201);
    await request(app)
      .post('/api/v1/transactions')
      .send({
        transactionDate: '2026-03-02',
        description: 'Refund',
        amount: '50.00',
        type: 'REFUND',
        categoryId: groceries.id,
      })
      .expect(201);

    const refreshed = await findByName('Groceries');
    expect(refreshed.lifetimeTotal).toBe('150.00');
    expect(refreshed.transactionCount).toBe(2);
  });
});

describe('POST/PATCH /api/v1/categories', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('creates a custom category', async () => {
    const response = await request(app)
      .post('/api/v1/categories')
      .send({ name: 'Pets', kind: 'EXPENSE', color: '#123456', description: 'Vet and food' })
      .expect(201);

    expect(response.body.data).toMatchObject({
      name: 'Pets',
      kind: 'EXPENSE',
      color: '#123456',
      isDefault: false,
    });
  });

  it('rejects a duplicate name with 409', async () => {
    await request(app)
      .post('/api/v1/categories')
      .send({ name: 'Pets', kind: 'EXPENSE' })
      .expect(409);
  });

  it('rejects a malformed colour', async () => {
    await request(app)
      .post('/api/v1/categories')
      .send({ name: 'Bad Colour', kind: 'EXPENSE', color: 'green' })
      .expect(400);
  });

  it('allows renaming but refuses a classification change while in use', async () => {
    const created = await request(app)
      .post('/api/v1/categories')
      .send({ name: 'Hobbies', kind: 'EXPENSE' })
      .expect(201);

    const renamed = await request(app)
      .patch(`/api/v1/categories/${created.body.data.id}`)
      .send({ name: 'Hobbies & Crafts' })
      .expect(200);
    expect(renamed.body.data.name).toBe('Hobbies & Crafts');

    await request(app)
      .post('/api/v1/transactions')
      .send({
        transactionDate: '2026-03-01',
        description: 'Model kit',
        amount: '75.00',
        type: 'EXPENSE',
        categoryId: created.body.data.id,
      })
      .expect(201);

    await request(app)
      .patch(`/api/v1/categories/${created.body.data.id}`)
      .send({ kind: 'INCOME' })
      .expect(409);
  });
});

describe('DELETE /api/v1/categories/:id', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  async function categoryWithTransactions(name: string): Promise<{ id: string; otherId: string }> {
    const created = await request(app)
      .post('/api/v1/categories')
      .send({ name, kind: 'EXPENSE' })
      .expect(201);
    const other = await request(app)
      .post('/api/v1/categories')
      .send({ name: `${name} alt`, kind: 'EXPENSE' })
      .expect(201);

    await request(app)
      .post('/api/v1/transactions')
      .send({
        transactionDate: '2026-03-01',
        description: 'Linked row',
        amount: '10.00',
        type: 'EXPENSE',
        categoryId: created.body.data.id,
      })
      .expect(201);

    return { id: created.body.data.id, otherId: other.body.data.id };
  }

  it('blocks deletion while transactions are linked (default strategy)', async () => {
    const { id } = await categoryWithTransactions('Blocked');
    const response = await request(app).delete(`/api/v1/categories/${id}`).expect(409);
    expect(response.body.error.details.linkedTransactions).toBe(1);
  });

  it('reassigns linked transactions when asked', async () => {
    const { id, otherId } = await categoryWithTransactions('Reassign me');
    const response = await request(app)
      .delete(`/api/v1/categories/${id}?strategy=reassign&reassignTo=${otherId}`)
      .expect(200);
    expect(response.body.data).toEqual({ deleted: true, reassigned: 1, uncategorized: 0 });

    const rows = await request(app).get(`/api/v1/transactions?categoryId=${otherId}`).expect(200);
    expect(rows.body.data).toHaveLength(1);
  });

  it('uncategorises linked transactions when asked', async () => {
    const { id } = await categoryWithTransactions('Uncategorise me');
    const response = await request(app)
      .delete(`/api/v1/categories/${id}?strategy=uncategorize`)
      .expect(200);
    expect(response.body.data).toEqual({ deleted: true, reassigned: 0, uncategorized: 1 });

    const rows = await request(app).get('/api/v1/transactions?categoryId=uncategorized').expect(200);
    expect(rows.body.data).toHaveLength(1);
  });

  it('refuses to reassign to a category of another kind', async () => {
    const { id } = await categoryWithTransactions('Wrong kind target');
    const salary = await findByName('Salary');
    await request(app)
      .delete(`/api/v1/categories/${id}?strategy=reassign&reassignTo=${salary.id}`)
      .expect(400);
  });
});
