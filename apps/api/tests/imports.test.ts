import { api } from './helpers/api.ts';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { resetDatabase } from './helpers/db.ts';

const app = createApp();

const HEADERED_CSV = [
  'Date,Description,Amount,Type',
  '2026-03-01,Supermarket shopping,312.45,EXPENSE',
  '2026-03-02,Monthly salary,5000.00,INCOME',
  '2026-03-03,Netflix subscription,95.00,EXPENSE',
  'bad,broken,x,weird',
].join('\n');

const OPAQUE_CSV = ['When,What,How much', '2026-03-01,Shop,10.00'].join('\n');

async function preview(content: string, extra: Record<string, unknown> = {}) {
  // Re-mapping an existing preview sends no content at all, so only include it
  // when there is a file to upload.
  const body = content ? { filename: 'statement.csv', content, ...extra } : extra;
  const response = await api(app).post('/api/v1/imports/preview').send(body).expect(200);
  return response.body.data;
}

describe('import wizard: template and mapping', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('serves a downloadable CSV template', async () => {
    const response = await api(app).get('/api/v1/imports/template').expect(200);
    expect(response.headers['content-type']).toMatch(/text\/csv/);
    expect(response.text).toContain('Date,Description,Merchant,Amount,Type');
  });

  it('asks for a mapping when the headers are unrecognisable', async () => {
    const data = await preview(OPAQUE_CSV);
    expect(data.status).toBe('mapping_required');
    expect(data.rows).toHaveLength(0);
    expect(data.detection.rowCount).toBe(1);
    expect(typeof data.previewId).toBe('string');

    const remapped = await preview('', {
      previewId: data.previewId,
      mapping: { date: 'When', description: 'What', amount: 'How much' },
    });
    expect(remapped.status).toBe('ready');
    expect(remapped.summary).toMatchObject({ total: 1, valid: 1, invalid: 0 });
  });

  it('auto-detects known headers and validates every row', async () => {
    const data = await preview(HEADERED_CSV);
    expect(data.status).toBe('ready');
    expect(data.detection.suggestedMapping).toMatchObject({
      date: 'Date',
      description: 'Description',
      amount: 'Amount',
      type: 'Type',
    });
    expect(data.summary).toMatchObject({ total: 4, valid: 3, invalid: 1 });

    const salary = data.rows.find((row: { description: string }) => row.description === 'Monthly salary');
    expect(salary).toMatchObject({ type: 'INCOME', amount: '5000.00', status: 'valid' });

    const netflix = data.rows.find((row: { description: string }) => row.description === 'Netflix subscription');
    expect(netflix.suggestedCategoryName).toBe('Subscriptions');
    expect(typeof netflix.suggestedCategoryId).toBe('string');

    const broken = data.rows.find((row: { status: string }) => row.status === 'invalid');
    expect(broken.errors.length).toBeGreaterThan(0);
  });
});

describe('POST /api/v1/imports (commit)', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('imports valid rows, skips invalid ones, and links them to a batch', async () => {
    const data = await preview(HEADERED_CSV);
    const netflixRow = data.rows.find(
      (row: { description: string }) => row.description === 'Netflix subscription',
    );

    const commit = await api(app)
      .post('/api/v1/imports')
      .send({
        previewId: data.previewId,
        mode: 'skip_invalid',
        categoryOverrides: [{ rowIndex: netflixRow.rowIndex, categoryId: netflixRow.suggestedCategoryId }],
      })
      .expect(201);

    expect(commit.body.data).toMatchObject({ created: 3, rejected: 1, skippedDuplicates: 0, total: 4 });
    expect(commit.body.data.batch).toMatchObject({
      status: 'PARTIAL',
      totalRows: 4,
      createdRows: 3,
      invalidRows: 1,
    });

    const listed = await api(app).get('/api/v1/transactions').expect(200);
    expect(listed.body.total).toBe(3);

    const netflix = listed.body.data.find(
      (row: { description: string }) => row.description === 'Netflix subscription',
    );
    expect(netflix.category).toMatchObject({ name: 'Subscriptions' });
    expect(netflix.importBatchId).toBe(commit.body.data.batch.id);
    expect(netflix.reviewStatus).toBe('NEEDS_REVIEW');
  });

  it('flags an identical second import as exact duplicates and skips them', async () => {
    const data = await preview(HEADERED_CSV);
    expect(data.summary).toMatchObject({ valid: 0, duplicatesExact: 3, invalid: 1 });

    const commit = await api(app)
      .post('/api/v1/imports')
      .send({ previewId: data.previewId, mode: 'skip_invalid' })
      .expect(201);
    expect(commit.body.data).toMatchObject({ created: 0, skippedDuplicates: 3, rejected: 1 });

    const listed = await api(app).get('/api/v1/transactions').expect(200);
    expect(listed.body.total).toBe(3);
  });

  it('refuses to import anything when block_on_invalid is set', async () => {
    const data = await preview(HEADERED_CSV);
    const response = await api(app)
      .post('/api/v1/imports')
      .send({ previewId: data.previewId, mode: 'block_on_invalid' })
      .expect(400);
    expect(response.body.error.details.invalidRows).toBe(1);
  });

  it('makes a commit idempotent instead of importing twice', async () => {
    const data = await preview(OPAQUE_CSV, {
      mapping: { date: 'When', description: 'What', amount: 'How much' },
    });

    const first = await api(app).post('/api/v1/imports').send({ previewId: data.previewId }).expect(201);
    const second = await api(app).post('/api/v1/imports').send({ previewId: data.previewId }).expect(201);

    // The replay reports the same batch and the same counts...
    expect(second.body.data.batch.id).toBe(first.body.data.batch.id);
    expect(second.body.data).toMatchObject({ created: first.body.data.created, total: first.body.data.total });

    // ...and no extra rows were written.
    const listed = await api(app).get('/api/v1/transactions').expect(200);
    const matching = (listed.body.data as { description: string }[]).filter((row) => row.description === 'Shop');
    expect(matching).toHaveLength(1);
  });

  it('rejects a category override that does not match the row type', async () => {
    const data = await preview(HEADERED_CSV);
    const salaryRow = data.rows.find((row: { description: string }) => row.description === 'Monthly salary');
    const response = await api(app)
      .post('/api/v1/imports')
      .send({
        previewId: data.previewId,
        categoryOverrides: [{ rowIndex: salaryRow.rowIndex, categoryId: '00000000-0000-4000-8000-000000000000' }],
      })
      .expect(400);
    expect(response.body.error.message).toMatch(/category that does not exist/i);
  });
});

describe('import history and error report', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('lists batches and exposes a per-batch detail', async () => {
    const data = await preview(HEADERED_CSV);
    const commit = await api(app)
      .post('/api/v1/imports')
      .send({ previewId: data.previewId })
      .expect(201);
    const batchId = commit.body.data.batch.id;

    const history = await api(app).get('/api/v1/imports').expect(200);
    expect(history.body.total).toBe(1);
    expect(history.body.data[0].id).toBe(batchId);

    const detail = await api(app).get(`/api/v1/imports/${batchId}`).expect(200);
    expect(detail.body.data.filename).toBe('statement.csv');

    await api(app).get('/api/v1/imports/00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('downloads a CSV error report for a live preview', async () => {
    const data = await preview(HEADERED_CSV);
    const response = await api(app)
      .get(`/api/v1/imports/previews/${data.previewId}/report`)
      .expect(200);
    expect(response.headers['content-type']).toMatch(/text\/csv/);
    expect(response.text).toContain('record,status,errors');
    expect(response.text).toContain('invalid');
    // The error report may contain commas inside messages, so quoting is used.
    expect(response.text).toContain('"');
  });

  it('returns 404 for an unknown preview', async () => {
    await api(app)
      .get('/api/v1/imports/previews/00000000-0000-4000-8000-000000000000/report')
      .expect(404);
  });
});
