import { api } from './helpers/api.ts';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { createSecondUser, resetDatabase } from './helpers/db.ts';
import { loginAs, request } from './helpers/api.ts';

/**
 * Category rules.
 *
 * Rules only fill in a *missing* category. These specs pin the two properties
 * the feature promises: deterministic precedence, and never overwriting a
 * category that already exists.
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

async function createRule(body: Record<string, unknown>) {
  const response = await api(app).post('/api/v1/category-rules').send(body);
  return { status: response.status, body: response.body };
}

async function createRuleOk(body: Record<string, unknown>) {
  const result = await createRule(body);
  if (result.status !== 201) throw new Error(`rule create failed: ${JSON.stringify(result.body)}`);
  return result.body.data;
}

async function addTransaction(body: Record<string, unknown>) {
  const response = await api(app)
    .post('/api/v1/transactions')
    .send({ transactionDate: '2026-04-01', description: 'Row', amount: '10.00', type: 'EXPENSE', ...body })
    .expect(201);
  return response.body.data;
}

async function importCsv(csv: string) {
  const preview = await api(app)
    .post('/api/v1/imports/preview')
    .send({ filename: 'statement.csv', content: csv })
    .expect(200);
  return preview.body.data;
}

describe('category rules: CRUD', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('creates a rule and normalises the pattern', async () => {
    const groceries = await categoryId('Groceries');
    const rule = await createRuleOk({ matchField: 'MERCHANT', pattern: '  SHOPRITE  ', categoryId: groceries });

    expect(rule).toMatchObject({
      matchField: 'MERCHANT',
      pattern: 'shoprite',
      categoryId: groceries,
      priority: 100,
      isActive: true,
    });
    expect(rule.category).toMatchObject({ id: groceries, name: 'Groceries' });
  });

  it('rejects a duplicate field+pattern pair', async () => {
    const groceries = await categoryId('Groceries');
    const response = await createRule({ matchField: 'MERCHANT', pattern: 'ShopRite', categoryId: groceries });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('rejects an unknown category', async () => {
    const response = await createRule({
      matchField: 'MERCHANT',
      pattern: 'nowhere',
      categoryId: '00000000-0000-4000-8000-000000000000',
    });
    expect(response.status).toBe(404);
  });

  it('rejects a pattern that is too short or too long', async () => {
    const groceries = await categoryId('Groceries');
    const tooShort = await createRule({ matchField: 'ANY', pattern: 'x', categoryId: groceries });
    expect(tooShort.status).toBe(400);
    expect(tooShort.body.error.code).toBe('VALIDATION_ERROR');

    const tooLong = await createRule({ matchField: 'ANY', pattern: 'x'.repeat(121), categoryId: groceries });
    expect(tooLong.status).toBe(400);
  });

  it('updates and deletes a rule', async () => {
    const dinners = await categoryId('Dining');
    const rule = await createRuleOk({ matchField: 'DESCRIPTION', pattern: 'uber eats', categoryId: dinners });

    const updated = await api(app)
      .patch(`/api/v1/category-rules/${rule.id}`)
      .send({ pattern: 'UBER  EATS', priority: 5 })
      .expect(200);
    expect(updated.body.data).toMatchObject({ pattern: 'uber  eats', priority: 5 });

    // Now clashing with the new pattern is rejected.
    const clashes = await createRule({ matchField: 'DESCRIPTION', pattern: 'uber  eats', categoryId: dinners });
    expect(clashes.status).toBe(409);

    await api(app).delete(`/api/v1/category-rules/${rule.id}`).expect(204);
    await api(app).get(`/api/v1/category-rules/${rule.id}`).expect(404);
  });

  it('lists rules in evaluation order', async () => {
    const groceries = await categoryId('Groceries');
    const transport = await categoryId('Transport');

    await createRuleOk({ matchField: 'ANY', pattern: 'aaa', categoryId: groceries, priority: 1 });
    // Same priority, longer pattern: more specific, so it is evaluated first.
    await createRuleOk({ matchField: 'ANY', pattern: 'aaaaaa', categoryId: transport, priority: 1 });
    await createRuleOk({ matchField: 'ANY', pattern: 'bb', categoryId: groceries, priority: 9 });

    const response = await api(app).get('/api/v1/category-rules').expect(200);
    const patterns = (response.body.data as { pattern: string }[]).map((rule) => rule.pattern);
    expect(patterns.slice(0, 3)).toEqual(['aaaaaa', 'aaa', 'bb']);
  });

  it('isolates rules between workspaces', async () => {
    const other = await createSecondUser('rules-other@spendscope.test');
    const cookie = await loginAs(app, other.email, other.password);

    const listed = await request(app).get('/api/v1/category-rules').set('Cookie', cookie).expect(200);
    expect(listed.body.data).toEqual([]);

    const own = await request(app).get('/api/v1/categories').set('Cookie', cookie).expect(200);
    const ownCategory = (own.body.data as CategoryRef[]).find((category) => category.name === 'Groceries');

    // A rule cannot point at another workspace's category.
    const response = await request(app)
      .post('/api/v1/category-rules')
      .set('Cookie', cookie)
      .send({ matchField: 'ANY', pattern: 'zz', categoryId: (ownCategory as CategoryRef).id });
    expect(response.status).toBe(201);

    // ...and the first workspace's list is unchanged.
    const mine = await api(app).get('/api/v1/category-rules').expect(200);
    expect((mine.body.data as { pattern: string }[]).some((rule) => rule.pattern === 'zz')).toBe(false);
  });
});

describe('category rules: precedence', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('applies the highest-precedence matching rule to a categorised-less row', async () => {
    const groceries = await categoryId('Groceries');
    const transport = await categoryId('Transport');

    await createRuleOk({ matchField: 'ANY', pattern: 'shell', categoryId: transport, priority: 50 });
    await createRuleOk({ matchField: 'ANY', pattern: 'shell station', categoryId: groceries, priority: 1 });

    await addTransaction({ description: 'Shell station fill up', merchant: 'Shell', amount: '200.00' });

    const applied = await api(app).post('/api/v1/category-rules/apply').send({ dryRun: false }).expect(200);
    expect(applied.body.data).toMatchObject({ dryRun: false, scanned: 1, matched: 1, updated: 1 });

    const list = await api(app).get('/api/v1/transactions').expect(200);
    expect(list.body.data[0].categoryId).toBe(groceries);
  });

  it('breaks priority ties in favour of the more specific pattern', async () => {
    await resetDatabase();
    const groceries = await categoryId('Groceries');
    const transport = await categoryId('Transport');

    await createRuleOk({ matchField: 'DESCRIPTION', pattern: 'fuel', categoryId: transport, priority: 10 });
    await createRuleOk({ matchField: 'DESCRIPTION', pattern: 'fuel card', categoryId: groceries, priority: 10 });

    await addTransaction({ description: 'Fuel card top up', amount: '30.00' });
    await api(app).post('/api/v1/category-rules/apply').send({ dryRun: false }).expect(200);

    const list = await api(app).get('/api/v1/transactions').expect(200);
    expect(list.body.data[0].categoryId).toBe(groceries);
  });

  it('never categorises a transaction of the wrong kind', async () => {
    await resetDatabase();
    const groceries = await categoryId('Groceries');
    await createRuleOk({ matchField: 'DESCRIPTION', pattern: 'acme', categoryId: groceries, priority: 1 });

    const salary = await addTransaction({ type: 'INCOME', description: 'Acme payroll', amount: '1000.00' });

    const applied = await api(app).post('/api/v1/category-rules/apply').send({ dryRun: false }).expect(200);
    expect(applied.body.data).toMatchObject({ scanned: 1, matched: 0, updated: 0 });

    const detail = await api(app).get(`/api/v1/transactions/${salary.id}`).expect(200);
    expect(detail.body.data.categoryId).toBeNull();
  });

  it('never categorises transfers', async () => {
    await resetDatabase();
    const groceries = await categoryId('Groceries');
    await createRuleOk({ matchField: 'ANY', pattern: 'savings', categoryId: groceries, priority: 1 });

    const transfer = await addTransaction({ type: 'TRANSFER', description: 'To savings', amount: '500.00' });

    const applied = await api(app).post('/api/v1/category-rules/apply').send({ dryRun: false }).expect(200);
    expect(applied.body.data).toMatchObject({ scanned: 0, matched: 0 });

    const detail = await api(app).get(`/api/v1/transactions/${transfer.id}`).expect(200);
    expect(detail.body.data.categoryId).toBeNull();
  });

  it('ignores inactive rules', async () => {
    await resetDatabase();
    const groceries = await categoryId('Groceries');
    await createRuleOk({ matchField: 'ANY', pattern: 'market', categoryId: groceries, isActive: false });

    await addTransaction({ description: 'Corner market', amount: '12.00' });
    const applied = await api(app).post('/api/v1/category-rules/apply').send({ dryRun: false }).expect(200);
    expect(applied.body.data).toMatchObject({ scanned: 1, matched: 0, updated: 0 });
  });
});

describe('category rules: retroactive application', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('dry-runs by default and reports where money would land', async () => {
    const groceries = await categoryId('Groceries');
    await createRuleOk({ matchField: 'ANY', pattern: 'shoprite', categoryId: groceries, priority: 1 });
    await addTransaction({ description: 'Shop', merchant: 'ShopRite', amount: '80.00' });

    const response = await api(app).post('/api/v1/category-rules/apply').send({}).expect(200);
    expect(response.body.data).toMatchObject({ dryRun: true, scanned: 1, matched: 1, updated: 0 });
    expect(response.body.data.perCategory).toEqual([
      { categoryId: groceries, categoryName: 'Groceries', matched: 1 },
    ]);

    // Nothing was written.
    const list = await api(app).get('/api/v1/transactions').expect(200);
    expect(list.body.data[0].categoryId).toBeNull();
  });

  it('never overwrites a category that already exists', async () => {
    await resetDatabase();
    const groceries = await categoryId('Groceries');
    const dining = await categoryId('Dining');
    await createRuleOk({ matchField: 'ANY', pattern: 'shoprite', categoryId: groceries, priority: 1 });

    const alreadyCategorised = await addTransaction({
      description: 'ShopRite run',
      merchant: 'ShopRite',
      amount: '50.00',
      categoryId: dining,
    });
    const uncategorised = await addTransaction({
      description: 'ShopRite run two',
      merchant: 'ShopRite',
      amount: '20.00',
    });

    const applied = await api(app).post('/api/v1/category-rules/apply').send({ dryRun: false }).expect(200);
    expect(applied.body.data).toMatchObject({ scanned: 1, matched: 1, updated: 1 });

    const kept = await api(app).get(`/api/v1/transactions/${alreadyCategorised.id}`).expect(200);
    expect(kept.body.data.categoryId).toBe(dining);
    const filled = await api(app).get(`/api/v1/transactions/${uncategorised.id}`).expect(200);
    expect(filled.body.data.categoryId).toBe(groceries);
  });
});

describe('category rules: CSV import integration', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('previews the rule-applied category and commits it', async () => {
    const groceries = await categoryId('Groceries');
    await createRuleOk({ matchField: 'MERCHANT', pattern: 'shoprite', categoryId: groceries, priority: 1 });

    const csv = [
      'Date,Description,Merchant,Amount,Type',
      '2026-05-01,Weekly shop,ShopRite,120.00,EXPENSE',
      '2026-05-02,Unknown vendor,VendorX,15.00,EXPENSE',
    ].join('\n');

    const preview = await importCsv(csv);
    expect(preview.status).toBe('ready');

    const shoprite = preview.rows.find((row: { merchant: string }) => row.merchant === 'ShopRite');
    expect(shoprite.suggestedCategoryId).toBe(groceries);
    expect(shoprite.suggestedCategoryName).toBe('Groceries');

    const vendorX = preview.rows.find((row: { merchant: string }) => row.merchant === 'VendorX');
    expect(vendorX.suggestedCategoryId).toBeNull();

    await api(app)
      .post('/api/v1/imports')
      .send({ previewId: preview.previewId, mode: 'skip_invalid' })
      .expect(201);

    const list = await api(app).get('/api/v1/transactions?search=Weekly%20shop').expect(200);
    expect(list.body.data[0].categoryId).toBe(groceries);
  });

  it('lets the category in the file win over a rule', async () => {
    await resetDatabase();
    const groceries = await categoryId('Groceries');
    await createRuleOk({ matchField: 'MERCHANT', pattern: 'shoprite', categoryId: groceries, priority: 1 });

    const csv = [
      'Date,Description,Merchant,Amount,Type,Category',
      '2026-05-03,Imported with category,ShopRite,30.00,EXPENSE,Dining',
    ].join('\n');

    const preview = await importCsv(csv);
    const dining = await categoryId('Dining');
    expect(preview.rows[0].suggestedCategoryId).toBe(dining);

    await api(app)
      .post('/api/v1/imports')
      .send({ previewId: preview.previewId, mode: 'skip_invalid' })
      .expect(201);

    const list = await api(app).get('/api/v1/transactions?search=Imported%20with%20category').expect(200);
    expect(list.body.data[0].categoryId).toBe(dining);
  });
});
