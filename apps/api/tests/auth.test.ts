import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { request } from './helpers/api.ts';
import { resetDatabase, TEST_USER_EMAIL, TEST_USER_PASSWORD } from './helpers/db.ts';

/**
 * Authentication behaviour, verified through the real HTTP endpoints.
 *
 * Each `describe` builds its own app instance: the rate limiters are per
 * instance, and that keeps the abuse-control tests from starving the
 * functional ones.
 */

interface AuthState {
  user: { id: string; email: string; name: string };
  workspace: { id: string; name: string };
}

function cookieOf(response: { headers: Record<string, unknown> }): string {
  const setCookie = response.headers['set-cookie'] as unknown as string[] | undefined;
  if (!setCookie || setCookie.length === 0) throw new Error('no session cookie was set');
  return setCookie[0]!.split(';')[0]!;
}

describe('auth: public configuration', () => {
  const app = createApp();

  it('exposes what the sign-in screen needs, and no secrets', async () => {
    const response = await request(app).get('/api/v1/auth/config').expect(200);
    expect(response.body.data).toMatchObject({ registrationEnabled: true, minPasswordLength: 12 });
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|DATABASE_URL|secret/i);
  });
});

describe('auth: registration', () => {
  const app = createApp();

  beforeAll(async () => {
    await resetDatabase();
  });

  async function registerUser(overrides: Record<string, unknown> = {}) {
    const email = `user-${Math.random().toString(36).slice(2, 10)}@example.test`;
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, name: 'New User', password: 'a-strong-passw0rd', ...overrides });
    return { response, email };
  }

  it('creates an account, an owned workspace and a secure session cookie', async () => {
    const { response } = await registerUser();
    expect(response.status).toBe(201);

    const state = response.body.data as AuthState;
    expect(state.user.email).toMatch(/@example\.test$/);
    expect(state.workspace.id).toMatch(/^[0-9a-f-]{36}$/);

    const setCookie = (response.headers['set-cookie'] as unknown as string[])[0]!;
    expect(setCookie).toMatch(/spendscope_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const me = await request(app).get('/api/v1/auth/me').set('Cookie', cookieOf(response)).expect(200);
    expect((me.body.data as AuthState).user.id).toBe(state.user.id);
  });

  it('never returns a password hash', async () => {
    const { response } = await registerUser();
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|scrypt\$/);
  });

  it('rejects a duplicate email with 409', async () => {
    const { email } = await registerUser();
    const second = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, name: 'Someone Else', password: 'a-strong-passw0rd' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
  });

  it('rejects a weak password with field-level issues', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'weak@example.test', name: 'Weak', password: 'short' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an invalid email shape', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', name: 'Nope', password: 'a-strong-passw0rd' });
    expect(response.status).toBe(400);
  });
});

describe('auth: sign-in, sessions and password', () => {
  const app = createApp();

  beforeAll(async () => {
    await resetDatabase();
  });

  it('signs in with correct credentials and rejects incorrect ones', async () => {
    const good = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD })
      .expect(200);
    expect((good.body.data as AuthState).user.email).toBe(TEST_USER_EMAIL);

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_USER_EMAIL, password: 'definitely-wr0ng' })
      .expect(401);
    expect(wrongPassword.body.error.code).toBe('UNAUTHORIZED');

    const unknownUser = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.test', password: 'definitely-wr0ng' })
      .expect(401);
    // Identical message: no account enumeration.
    expect(unknownUser.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('logs out and invalidates the session', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD })
      .expect(200);
    const cookie = cookieOf(login);

    await request(app).get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    await request(app).post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
    await request(app).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
  });

  it('lists sessions and revokes the others', async () => {
    const first = cookieOf(
      await request(app).post('/api/v1/auth/login').send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }).expect(200),
    );
    const second = cookieOf(
      await request(app).post('/api/v1/auth/login').send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }).expect(200),
    );

    const sessions = await request(app).get('/api/v1/auth/sessions').set('Cookie', first).expect(200);
    expect((sessions.body.data as unknown[]).length).toBeGreaterThanOrEqual(2);

    await request(app).post('/api/v1/auth/sessions/revoke-others').set('Cookie', first).expect(200);
    await request(app).get('/api/v1/auth/me').set('Cookie', first).expect(200);
    await request(app).get('/api/v1/auth/me').set('Cookie', second).expect(401);
  });

  it('changes the password only with the current one, revoking other sessions', async () => {
    const current = cookieOf(
      await request(app).post('/api/v1/auth/login').send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }).expect(200),
    );
    const other = cookieOf(
      await request(app).post('/api/v1/auth/login').send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }).expect(200),
    );

    await request(app)
      .post('/api/v1/auth/me/password')
      .set('Cookie', current)
      .send({ currentPassword: 'not-the-passw0rd', newPassword: 'brand-new-passw0rd' })
      .expect(401);

    await request(app)
      .post('/api/v1/auth/me/password')
      .set('Cookie', current)
      .send({ currentPassword: TEST_USER_PASSWORD, newPassword: 'brand-new-passw0rd' })
      .expect(200);

    await request(app).get('/api/v1/auth/me').set('Cookie', other).expect(401);
    await request(app).get('/api/v1/auth/me').set('Cookie', current).expect(200);

    // Restore the shared password so later specs can sign in.
    await request(app)
      .post('/api/v1/auth/me/password')
      .set('Cookie', current)
      .send({ currentPassword: 'brand-new-passw0rd', newPassword: TEST_USER_PASSWORD })
      .expect(200);
  });

  it('rejects requests with a forged cookie or a bearer token', async () => {
    await request(app).get('/api/v1/transactions').set('Cookie', 'spendscope_session=made-up').expect(401);
    await request(app).get('/api/v1/transactions').set('Authorization', 'Bearer made-up').expect(401);
  });
});

describe('auth: account deletion', () => {
  const app = createApp();

  beforeAll(async () => {
    await resetDatabase();
  });

  it('requires the confirmation token, and a session', async () => {
    await request(app).delete('/api/v1/auth/me').send({ confirm: 'DELETE' }).expect(401);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD })
      .expect(200);
    const cookie = cookieOf(login);

    const response = await request(app).delete('/api/v1/auth/me').set('Cookie', cookie).send({ confirm: 'yes' });
    expect(response.status).toBe(400);
  });

  it('deletes the account, its sessions and all of its data', async () => {
    const registration = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'delete-me@example.test', name: 'Delete Me', password: 'a-strong-passw0rd' })
      .expect(201);
    const cookie = cookieOf(registration);

    await request(app)
      .post('/api/v1/transactions')
      .set('Cookie', cookie)
      .send({ transactionDate: '2026-03-01', description: 'Temp', amount: '10.00', type: 'EXPENSE' })
      .expect(201);

    await request(app).delete('/api/v1/auth/me').set('Cookie', cookie).send({ confirm: 'DELETE' }).expect(200);

    await request(app).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'delete-me@example.test', password: 'a-strong-passw0rd' })
      .expect(401);
  });
});

describe('auth: abuse controls', () => {
  const app = createApp();

  it('rate-limits repeated sign-in attempts', async () => {
    let sawRateLimit = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'brute-force@example.test', password: 'wrong-passw0rd' });
      if (response.status === 429) {
        expect(response.body.error.code).toBe('RATE_LIMITED');
        sawRateLimit = true;
        break;
      }
    }
    expect(sawRateLimit).toBe(true);
  });

  it('rejects a state-changing request from a foreign origin (CSRF)', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example.com')
      .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('allows a state-changing request from a configured origin', async () => {
    const app2 = createApp();
    await request(app2)
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD })
      .expect(200);
  });
});
