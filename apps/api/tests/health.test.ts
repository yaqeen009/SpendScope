import { api } from './helpers/api.ts';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { resetDatabase } from './helpers/db.ts';

const app = createApp();

describe('GET /api/v1/health (liveness)', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('reports the process as alive without touching the database', async () => {
    const response = await api(app).get('/api/v1/health').expect(200);

    expect(response.body.data).toMatchObject({ status: 'ok' });
    expect(typeof response.body.data.uptimeSeconds).toBe('number');
    expect(typeof response.body.data.timestamp).toBe('string');
  });

  it('never leaks connection details', async () => {
    const response = await api(app).get('/api/v1/health').expect(200);
    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/postgres(ql)?:\/\//);
    expect(body).not.toMatch(/password/i);
  });
});

describe('GET /api/v1/health/ready (readiness)', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it('reports the database as reachable', async () => {
    const response = await api(app).get('/api/v1/health/ready').expect(200);

    expect(response.body.data).toMatchObject({ status: 'ready', database: 'up' });
    expect(typeof response.body.data.timestamp).toBe('string');
  });

  it('does not require a session', async () => {
    // Readiness must work before any account exists (load balancers probe it first).
    const response = await api(app).get('/api/v1/health/ready');
    expect([200, 503]).toContain(response.status);
  });
});

describe('unknown routes', () => {
  it('return a structured 404', async () => {
    const response = await api(app).get('/api/v1/does-not-exist').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

describe('cacheability', () => {
  /**
   * The split deployment reaches the API through a Vercel rewrite, and Vercel
   * caches an external rewrite when the origin allows it. Financial data and
   * session-bearing responses must never be stored by a shared cache, so every
   * response — success, rejection and 404 alike — is marked `no-store`.
   */
  it('marks every response uncacheable', async () => {
    const success = await api(app).get('/api/v1/health').expect(200);
    expect(success.headers['cache-control']).toBe('no-store');

    // The test helper registers a live session, so this is the case that
    // matters most: a session-bearing response carrying one account's data.
    const authenticated = await api(app).get('/api/v1/auth/me').expect(200);
    expect(authenticated.headers['cache-control']).toBe('no-store');

    const missing = await api(app).get('/api/v1/does-not-exist').expect(404);
    expect(missing.headers['cache-control']).toBe('no-store');
  });
});
