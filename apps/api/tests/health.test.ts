import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { resetDatabase } from './helpers/db.ts';

const app = createApp();

describe('GET /api/v1/health', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('reports the database and workspace as ready', async () => {
    const response = await request(app).get('/api/v1/health').expect(200);

    expect(response.body.data).toMatchObject({
      status: 'ok',
      database: 'up',
      workspaceReady: true,
    });
    expect(typeof response.body.data.uptimeSeconds).toBe('number');
    expect(typeof response.body.data.timestamp).toBe('string');
  });

  it('never leaks connection details', async () => {
    const response = await request(app).get('/api/v1/health').expect(200);
    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/postgres(ql)?:\/\//);
    expect(body).not.toMatch(/password/i);
  });
});

describe('unknown routes', () => {
  it('return a structured 404', async () => {
    const response = await request(app).get('/api/v1/does-not-exist').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
