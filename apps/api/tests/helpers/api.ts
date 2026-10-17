import request, { type Test } from 'supertest';
import type { Express } from 'express';

/**
 * Test HTTP client.
 *
 * Integration tests go through the real API, including authentication. This
 * helper attaches the session cookie created by `resetDatabase()` to every
 * request so individual specs stay readable.
 *
 * Unauthenticated requests must use `request(app)` directly — that is what the
 * isolation specs assert against.
 */

let sessionCookie: string | null = null;

export function setTestSessionCookie(value: string | null): void {
  sessionCookie = value;
}

export function currentTestSessionCookie(): string | null {
  return sessionCookie;
}

function withCookie(test: Test): Test {
  return sessionCookie ? test.set('Cookie', sessionCookie) : test;
}

export function api(app: Express) {
  return {
    get: (url: string) => withCookie(request(app).get(url)),
    post: (url: string) => withCookie(request(app).post(url)),
    patch: (url: string) => withCookie(request(app).patch(url)),
    delete: (url: string) => withCookie(request(app).delete(url)),
  };
}

/**
 * Logs in through the real endpoint and returns the raw `Cookie` header value,
 * so a spec can act as a second, fully independent user.
 */
export async function loginAs(app: Express, email: string, password: string): Promise<string> {
  const response = await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
  const setCookie = response.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('login did not return a session cookie');
  return raw.split(';')[0] ?? raw;
}

export { request };
