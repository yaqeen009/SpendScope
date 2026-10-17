import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { resetDatabase } from './helpers/db.ts';

const app = createApp();

describe('GET/PATCH /api/v1/settings', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('returns GHS defaults', async () => {
    const response = await request(app).get('/api/v1/settings').expect(200);
    expect(response.body.data).toMatchObject({
      currency: 'GHS',
      locale: 'en-GH',
      theme: 'system',
      defaultPeriod: 'this_month',
    });
  });

  it('updates display preferences', async () => {
    const response = await request(app)
      .patch('/api/v1/settings')
      .send({ currency: 'USD', theme: 'dark', defaultPeriod: 'last_month' })
      .expect(200);
    expect(response.body.data).toMatchObject({
      currency: 'USD',
      theme: 'dark',
      defaultPeriod: 'last_month',
    });
  });

  it('rejects an empty body and an unsupported currency', async () => {
    await request(app).patch('/api/v1/settings').send({}).expect(400);
    await request(app).patch('/api/v1/settings').send({ currency: 'XYZ' }).expect(400);
  });
});

describe('demo data and reset', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('restores and clears the sample dataset without touching imports', async () => {
    const restore = await request(app)
      .post('/api/v1/settings/demo-data')
      .send({ action: 'restore' })
      .expect(200);
    expect(restore.body.data.transactions).toBeGreaterThan(0);

    const listed = await request(app).get('/api/v1/transactions?pageSize=100').expect(200);
    expect(listed.body.data.every((row: { isSample: boolean }) => row.isSample)).toBe(true);

    const cleared = await request(app)
      .post('/api/v1/settings/demo-data')
      .send({ action: 'clear' })
      .expect(200);
    expect(cleared.body.data.transactions).toBeGreaterThan(0);

    const after = await request(app).get('/api/v1/transactions').expect(200);
    expect(after.body.total).toBe(0);
  });

  it('refuses a reset without the confirmation token', async () => {
    const response = await request(app)
      .post('/api/v1/settings/reset')
      .send({ confirm: 'nope', includeImported: true })
      .expect(400);
    expect(response.body.error.message).toMatch(/confirmation token/i);
  });

  it('resets imported transactions when confirmed', async () => {
    await request(app)
      .post('/api/v1/transactions')
      .send({ transactionDate: '2026-03-01', description: 'Imported row', amount: '10.00', type: 'EXPENSE' })
      .expect(201);

    const response = await request(app)
      .post('/api/v1/settings/reset')
      .send({ confirm: 'RESET', includeImported: true })
      .expect(200);
    expect(response.body.data.transactions).toBe(1);

    const after = await request(app).get('/api/v1/transactions').expect(200);
    expect(after.body.total).toBe(0);
  });
});
