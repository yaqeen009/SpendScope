import { api, loginAs, request } from './helpers/api.ts';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { createSecondUser, resetDatabase } from './helpers/db.ts';

/**
 * Recurring-transaction detection endpoint.
 *
 * Detection is heuristic, so the contract under test is: it finds a clear
 * monthly subscription, it never writes anything, and a dismissal is honoured
 * per workspace.
 */

const app = createApp();

const MONTHS = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05'];

async function addTransaction(body: Record<string, unknown>) {
  const response = await api(app)
    .post('/api/v1/transactions')
    .send({ description: 'Subscription', amount: '95.00', type: 'EXPENSE', ...body })
    .expect(201);
  return response.body.data;
}

async function seedMonthlySubscription() {
  for (const date of MONTHS) {
    await addTransaction({ transactionDate: date, description: 'Netflix subscription', merchant: 'Netflix' });
  }
}

interface Series {
  seriesKey: string;
  name: string;
  cadence: string;
  occurrences: number;
  dismissed: boolean;
}

describe('recurring detection', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('detects a monthly subscription without changing any data', async () => {
    await seedMonthlySubscription();
    const before = await api(app).get('/api/v1/transactions').expect(200);

    const response = await api(app).get('/api/v1/recurring').expect(200);
    const series = response.body.data as Series[];

    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({
      name: 'Netflix',
      cadence: 'monthly',
      occurrences: 4,
      dismissed: false,
    });

    // Read-only: the transaction list is unchanged (same ids, same count).
    const after = await api(app).get('/api/v1/transactions').expect(200);
    expect(after.body.total).toBe(before.body.total);
    expect((after.body.data as { id: string }[]).map((row) => row.id)).toEqual(
      (before.body.data as { id: string }[]).map((row) => row.id),
    );
  });

  it('hides a dismissed series unless asked to include it', async () => {
    const detected = (await api(app).get('/api/v1/recurring').expect(200)).body.data as Series[];
    const target = detected[0]!;

    await api(app)
      .post('/api/v1/recurring/dismiss')
      .send({ seriesKey: target.seriesKey, name: target.name, reason: 'Not a commitment' })
      .expect(201);

    expect((await api(app).get('/api/v1/recurring').expect(200)).body.data).toEqual([]);

    const all = (await api(app).get('/api/v1/recurring?includeDismissed=true').expect(200)).body.data as Series[];
    expect(all).toHaveLength(1);
    expect(all[0]!.dismissed).toBe(true);
  });

  it('restores a dismissed series on request', async () => {
    const target = ((await api(app).get('/api/v1/recurring?includeDismissed=true').expect(200)).body.data as Series[])[0]!;

    await api(app).delete(`/api/v1/recurring/dismiss/${encodeURIComponent(target.seriesKey)}`).expect(204);

    const visible = (await api(app).get('/api/v1/recurring').expect(200)).body.data as Series[];
    expect(visible).toHaveLength(1);
    expect(visible[0]!.dismissed).toBe(false);
  });

  it('rejects dismissing a series that was never detected', async () => {
    const response = await api(app)
      .post('/api/v1/recurring/dismiss')
      .send({ seriesKey: 'made up|1.00', name: 'Made up' });
    expect(response.status).toBe(404);
  });

  it('rejects undismissing something that is not dismissed', async () => {
    await api(app).delete('/api/v1/recurring/dismiss/no-such-key').expect(404);
  });

  it('reports nothing for a workspace with no recurring rows', async () => {
    const other = await createSecondUser('recurring-other@spendscope.test');
    const cookie = await loginAs(app, other.email, other.password);

    const response = await request(app).get('/api/v1/recurring').set('Cookie', cookie).expect(200);
    expect(response.body.data).toEqual([]);
  });
});
