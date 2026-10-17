import { api, loginAs, request } from './helpers/api.ts';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { createSecondUser, resetDatabase } from './helpers/db.ts';

/**
 * CSV export and workspace backup/restore.
 *
 * The restore specs use a genuinely separate account and prove two things: the
 * data round-trips, and a restore never touches a workspace other than the one
 * the session owns.
 */

const app = createApp();

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

async function addTransaction(body: Record<string, unknown>) {
  const response = await api(app)
    .post('/api/v1/transactions')
    .send({ transactionDate: '2026-06-01', description: 'Row', amount: '10.00', type: 'EXPENSE', ...body })
    .expect(201);
  return response.body.data;
}

describe('GET /api/v1/exports/transactions.csv', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('exports filtered rows and neutralises formula injection', async () => {
    const groceries = await categoryId('Groceries');
    await addTransaction({
      description: '=cmd|\' /C calc\'!A0',
      merchant: '+SUM(1,1)',
      amount: '12.34',
      categoryId: groceries,
      notes: '@import',
    });
    await addTransaction({ description: 'Ordinary row', amount: '1.00' });

    const response = await api(app).get('/api/v1/exports/transactions.csv?search=cmd').expect(200);
    expect(response.headers['content-type']).toMatch(/text\/csv/);
    expect(response.headers['content-disposition']).toMatch(/attachment; filename=/);

    // A leading quote stops a spreadsheet treating the cell as a formula.
    expect(response.text).toContain("'=cmd|' /C calc'!A0");
    expect(response.text).toContain(`"'+SUM(1,1)"`);
    expect(response.text).toContain("'@import");

    // Amounts and dates stay untouched.
    expect(response.text).toContain('2026-06-01');
    expect(response.text).toContain('12.34');

    // The search filter is respected.
    expect(response.text).not.toContain('Ordinary row');
  });

  it('filters by type and reports truncation in a header', async () => {
    const response = await api(app).get('/api/v1/exports/transactions.csv?type=INCOME').expect(200);
    expect(response.headers['x-total-truncated']).toBe('false');
    // Header row only: there are no income rows in this workspace.
    expect(response.text.split('\r\n').filter((line) => line.length > 0)).toHaveLength(1);
  });
});

describe('backup and restore', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('requires an explicit confirmation and a valid document', async () => {
    const noConfirm = await api(app)
      .post('/api/v1/exports/restore')
      .send({ mode: 'merge', backup: {} })
      .expect(400);
    expect(noConfirm.body.error.code).toBe('VALIDATION_ERROR');

    const wrongFormat = await api(app)
      .post('/api/v1/exports/restore')
      .send({
        mode: 'merge',
        confirm: 'RESTORE',
        backup: { format: 'something-else', version: 1, exportedAt: 'x', categories: [], transactions: [], budgets: [] },
      })
      .expect(400);
    expect(wrongFormat.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('round-trips a workspace into another account, preserving refund links', async () => {
    await resetDatabase();
    const groceries = await categoryId('Groceries');
    const expense = await addTransaction({
      description: 'Whole month shop',
      merchant: 'ShopRite',
      amount: '300.00',
      categoryId: groceries,
    });
    await addTransaction({
      type: 'REFUND',
      description: 'Returned item',
      amount: '50.00',
      refundOfTransactionId: expense.id,
    });
    await api(app).post('/api/v1/budgets').send({ month: '2026-06', amount: '500.00', categoryId: groceries }).expect(201);

    const backup = await api(app).get('/api/v1/exports/backup.json').expect(200);
    expect(backup.body).toMatchObject({ format: 'spendscope-backup', version: 1 });
    expect(backup.body.transactions).toHaveLength(2);
    expect(backup.body.categories.length).toBeGreaterThan(0);
    expect(backup.body.budgets).toHaveLength(1);

    // A second, independent account restores the document.
    const other = await createSecondUser('restore-target@spendscope.test');
    const cookie = await loginAs(app, other.email, other.password);

    const restored = await request(app)
      .post('/api/v1/exports/restore')
      .set('Cookie', cookie)
      .send({ mode: 'replace', confirm: 'RESTORE', backup: backup.body })
      .expect(200);

    expect(restored.body.data).toMatchObject({
      mode: 'replace',
      transactions: 2,
      budgets: 1,
      uncategorisedByMissingCategory: 0,
    });

    const list = await request(app).get('/api/v1/transactions').set('Cookie', cookie).expect(200);
    expect(list.body.total).toBe(2);

    const refund = (list.body.data as { type: string; refundOfTransactionId: string | null; categoryId: string | null }[]).find(
      (row) => row.type === 'REFUND',
    );
    expect(refund).toBeDefined();
    // The refund links to the restored expense (a new id) and kept its category.
    expect(refund?.refundOfTransactionId).toBeTruthy();
    expect(refund?.categoryId).toBeTruthy();

    const budgets = await request(app).get('/api/v1/budgets?month=2026-06').set('Cookie', cookie).expect(200);
    expect(budgets.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('never modifies another workspace', async () => {
    await resetDatabase();
    const mine = await addTransaction({ description: 'Belongs to the first owner', amount: '5.00' });
    expect(mine.id).toBeTruthy();

    const other = await createSecondUser('innocent@spendscope.test');
    const cookie = await loginAs(app, other.email, other.password);

    // Replace the second workspace with an empty document.
    await request(app)
      .post('/api/v1/exports/restore')
      .set('Cookie', cookie)
      .send({
        mode: 'replace',
        confirm: 'RESTORE',
        backup: { format: 'spendscope-backup', version: 1, exportedAt: new Date().toISOString(), categories: [], transactions: [], budgets: [] },
      })
      .expect(200);

    // The first workspace is untouched.
    const stillThere = await api(app).get(`/api/v1/transactions/${mine.id}`).expect(200);
    expect(stillThere.body.data.description).toBe('Belongs to the first owner');
  });

  it('reports rows whose category is missing from the document', async () => {
    await resetDatabase();
    const other = await createSecondUser('missing-category@spendscope.test');
    const cookie = await loginAs(app, other.email, other.password);

    const response = await request(app)
      .post('/api/v1/exports/restore')
      .set('Cookie', cookie)
      .send({
        mode: 'replace',
        confirm: 'RESTORE',
        backup: {
          format: 'spendscope-backup',
          version: 1,
          exportedAt: new Date().toISOString(),
          categories: [],
          budgets: [],
          transactions: [
            {
              transactionDate: '2026-06-02',
              description: 'Orphan category row',
              amount: '9.99',
              type: 'EXPENSE',
              categoryName: 'Not In This Backup',
              categoryKind: 'EXPENSE',
            },
          ],
        },
      })
      .expect(200);

    expect(response.body.data).toMatchObject({ transactions: 1, uncategorisedByMissingCategory: 1 });

    const list = await request(app).get('/api/v1/transactions').set('Cookie', cookie).expect(200);
    expect(list.body.data[0].categoryId).toBeNull();
  });

  it('rejects a document with duplicate category names', async () => {
    await resetDatabase();
    const other = await createSecondUser('dupes@spendscope.test');
    const cookie = await loginAs(app, other.email, other.password);

    const response = await request(app)
      .post('/api/v1/exports/restore')
      .set('Cookie', cookie)
      .send({
        mode: 'replace',
        confirm: 'RESTORE',
        backup: {
          format: 'spendscope-backup',
          version: 1,
          exportedAt: new Date().toISOString(),
          categories: [
            { name: 'Groceries', kind: 'EXPENSE' },
            { name: 'groceries', kind: 'EXPENSE' },
          ],
          transactions: [],
          budgets: [],
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('more than once');
  });
});
