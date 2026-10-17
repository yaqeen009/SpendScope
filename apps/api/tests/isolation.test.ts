import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { api, loginAs, request } from './helpers/api.ts';
import { createSecondUser, resetDatabase } from './helpers/db.ts';

const app = createApp();

const RANGE = 'period=this_year';

/**
 * Workspace isolation.
 *
 * User A is the account provisioned by `resetDatabase()` (its session cookie is
 * attached by the `api()` helper). User B logs in through the real endpoint and
 * uses a separate cookie. Every assertion proves B cannot reach A's data through
 * a guessed id, a nested resource, or an aggregate.
 */
describe('workspace isolation', () => {
  let otherCookie: string;

  let transactionId: string;
  let categoryId: string;
  let budgetId: string;
  let previewId: string;

  beforeAll(async () => {
    await resetDatabase();

    const other = await createSecondUser('isolation-b@spendscope.test');
    otherCookie = await loginAs(app, other.email, other.password);

    // --- User A creates a complete set of data -----------------------------
    const category = await api(app)
      .post('/api/v1/categories')
      .send({ name: 'A Private Category', kind: 'EXPENSE', color: '#123456' })
      .expect(201);
    categoryId = category.body.data.id;

    const transaction = await api(app)
      .post('/api/v1/transactions')
      .send({
        transactionDate: '2026-03-05',
        description: 'A private transaction',
        amount: '4321.00',
        type: 'EXPENSE',
        categoryId,
      })
      .expect(201);
    transactionId = transaction.body.data.id;

    const budget = await api(app)
      .post('/api/v1/budgets')
      .send({ month: '2026-03', amount: '1000.00' })
      .expect(201);
    budgetId = budget.body.data.id;

    const preview = await api(app)
      .post('/api/v1/imports/preview')
      .send({
        filename: 'a-private.csv',
        content: 'Date,Description,Amount\n2026-03-01,A private row,10.00\n',
      })
      .expect(200);
    previewId = preview.body.data.previewId as string;
  });

  it('rejects unauthenticated access to every protected route', async () => {
    const protectedGets = [
      '/api/v1/transactions',
      `/api/v1/transactions/${transactionId}`,
      '/api/v1/categories',
      `/api/v1/categories/${categoryId}`,
      '/api/v1/budgets',
      `/api/v1/budgets/${budgetId}`,
      '/api/v1/analytics/summary',
      '/api/v1/analytics/dashboard',
      '/api/v1/analytics/categories',
      '/api/v1/analytics/time-series',
      '/api/v1/imports',
      '/api/v1/settings',
      '/api/v1/auth/me',
      '/api/v1/auth/sessions',
    ];

    for (const url of protectedGets) {
      const response = await request(app).get(url);
      expect(response.status, `GET ${url}`).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    }

    const protectedWrites = [
      '/api/v1/transactions',
      '/api/v1/categories',
      '/api/v1/budgets',
      '/api/v1/imports/preview',
      '/api/v1/imports',
      '/api/v1/settings/demo-data',
      '/api/v1/settings/reset',
    ];

    for (const url of protectedWrites) {
      const response = await request(app).post(url).send({});
      expect(response.status, `POST ${url}`).toBe(401);
    }
  });

  it('does not leak another workspace transaction by id', async () => {
    const response = await request(app)
      .get(`/api/v1/transactions/${transactionId}`)
      .set('Cookie', otherCookie)
      .expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(response.body)).not.toMatch(/A private transaction|4321/);
  });

  it('does not list another workspace transaction', async () => {
    const response = await request(app)
      .get('/api/v1/transactions')
      .set('Cookie', otherCookie)
      .expect(200);
    expect(JSON.stringify(response.body)).not.toMatch(/A private transaction/);
    expect(response.body.total).toBe(0);
  });

  it('cannot update or delete another workspace transaction', async () => {
    await request(app)
      .patch(`/api/v1/transactions/${transactionId}`)
      .set('Cookie', otherCookie)
      .send({ description: 'hijacked' })
      .expect(404);

    await request(app).delete(`/api/v1/transactions/${transactionId}`).set('Cookie', otherCookie).expect(404);

    // The row is untouched.
    const still = await api(app).get(`/api/v1/transactions/${transactionId}`).expect(200);
    expect(still.body.data.description).toBe('A private transaction');
  });

  it('cannot read another workspace category and cannot attach it', async () => {
    await request(app).get(`/api/v1/categories/${categoryId}`).set('Cookie', otherCookie).expect(404);

    const categories = await request(app).get('/api/v1/categories').set('Cookie', otherCookie).expect(200);
    expect(JSON.stringify(categories.body)).not.toMatch(/A Private Category/);

    await request(app)
      .post('/api/v1/transactions')
      .set('Cookie', otherCookie)
      .send({
        transactionDate: '2026-03-06',
        description: 'Trying to use a foreign category',
        amount: '10.00',
        type: 'EXPENSE',
        categoryId,
      })
      .expect(404);
  });

  it('cannot read or delete another workspace budget', async () => {
    await request(app).get(`/api/v1/budgets/${budgetId}`).set('Cookie', otherCookie).expect(404);
    await request(app).delete(`/api/v1/budgets/${budgetId}`).set('Cookie', otherCookie).expect(404);

    const list = await request(app).get('/api/v1/budgets?month=2026-03').set('Cookie', otherCookie).expect(200);
    expect(list.body.data).toEqual([]);
  });

  it('derives no analytics from another workspace', async () => {
    const summary = await request(app)
      .get(`/api/v1/analytics/summary?${RANGE}`)
      .set('Cookie', otherCookie)
      .expect(200);
    expect(summary.body.data.current.expenses).toBe('0.00');
    expect(summary.body.data.current.transactionCount).toBe(0);

    const breakdown = await request(app)
      .get(`/api/v1/analytics/categories?${RANGE}`)
      .set('Cookie', otherCookie)
      .expect(200);
    expect(JSON.stringify(breakdown.body)).not.toMatch(/A Private Category|4321/);

    const dashboard = await request(app)
      .get(`/api/v1/analytics/dashboard?${RANGE}`)
      .set('Cookie', otherCookie)
      .expect(200);
    expect(JSON.stringify(dashboard.body)).not.toMatch(/A private transaction|A Private Category|4321/);
  });

  it('cannot use another workspace import preview', async () => {
    const response = await request(app)
      .post('/api/v1/imports')
      .set('Cookie', otherCookie)
      .send({ previewId, mode: 'skip_invalid', categoryOverrides: [], importDuplicates: false })
      .expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');

    await request(app)
      .get(`/api/v1/imports/previews/${previewId}/report`)
      .set('Cookie', otherCookie)
      .expect(404);
  });

  it('keeps import history separated', async () => {
    const response = await request(app).get('/api/v1/imports').set('Cookie', otherCookie).expect(200);
    expect(response.body.total).toBe(0);
  });

  it('cannot revoke another workspace session', async () => {
    const sessions = await api(app).get('/api/v1/auth/sessions').expect(200);
    const otherSessionId = (sessions.body.data as { id: string }[])[0]!.id;

    await request(app)
      .delete(`/api/v1/auth/sessions/${otherSessionId}`)
      .set('Cookie', otherCookie)
      .expect(404);

    // A's session survives.
    await api(app).get('/api/v1/auth/me').expect(200);
  });
});
