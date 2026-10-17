import { api, request } from './helpers/api.ts';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { resetDatabase } from './helpers/db.ts';

/**
 * Observability.
 *
 * Every response carries a request id, so a user can quote one line and an
 * operator can find the matching log entry. Nothing else internal is exposed.
 */

const app = createApp();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('request ids', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('assigns an id to every response and accepts an inbound one', async () => {
    const generated = await api(app).get('/api/v1/transactions').expect(200);
    expect(generated.headers['x-request-id']).toMatch(UUID_PATTERN);

    // A trusted edge can pass its own id through, and it is echoed unchanged.
    const supplied = await request(app).get('/api/v1/health').set('x-request-id', 'edge-trace-42').expect(200);
    expect(supplied.headers['x-request-id']).toBe('edge-trace-42');
  });

  it('ignores an inbound id that is not a safe token', async () => {
    const spaced = await request(app).get('/api/v1/health').set('x-request-id', 'bad id here').expect(200);
    expect(spaced.headers['x-request-id']).toMatch(UUID_PATTERN);

    const tooLong = await request(app).get('/api/v1/health').set('x-request-id', 'x'.repeat(200)).expect(200);
    expect(tooLong.headers['x-request-id']).toMatch(UUID_PATTERN);
  });

  it('includes the request id on errors so it can be reported', async () => {
    const response = await api(app).get('/api/v1/transactions/not-a-uuid');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('returns a request id for an unknown endpoint', async () => {
    const response = await api(app).get('/api/v1/nope').expect(404);
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });
});
