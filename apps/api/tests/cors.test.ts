import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { request } from './helpers/api.ts';

/**
 * CORS posture for the deployed split: the frontend is served from one origin
 * (Vercel) and calls the API (Render) cross-site. A credentials-allowing
 * response is only ever sent for the configured frontend origin — never `*`,
 * never for a foreign origin.
 */

const FRONTEND_ORIGIN = 'http://localhost:5173';
const FOREIGN_ORIGIN = 'https://evil.example';

describe('CORS', () => {
  const app = createApp();

  it('allows the configured frontend origin with credentials', async () => {
    const response = await request(app).get('/api/v1/health').set('Origin', FRONTEND_ORIGIN);

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(FRONTEND_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('sends no CORS headers to a foreign origin', async () => {
    const response = await request(app).get('/api/v1/health').set('Origin', FOREIGN_ORIGIN);

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('answers a preflight for the configured origin with the allowed methods', async () => {
    const response = await request(app)
      .options('/api/v1/auth/register')
      .set('Origin', FRONTEND_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(FRONTEND_ORIGIN);
    expect(response.headers['access-control-allow-methods']).toContain('POST');
  });

  it('leaves a preflight from a foreign origin unanswered', async () => {
    const response = await request(app)
      .options('/api/v1/auth/register')
      .set('Origin', FOREIGN_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows same-origin requests, which send no Origin header', async () => {
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
