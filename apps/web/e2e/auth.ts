import { expect, type Page } from '@playwright/test';

/**
 * Shared end-to-end account.
 *
 * The API now requires an authenticated session, so the specs sign in before
 * exercising a page. Requests go through the Vite dev server (`/api/...` is
 * proxied to the API) so the session cookie is stored in the browser context
 * exactly as it would be for a real user.
 */
export const E2E_EMAIL = process.env.E2E_EMAIL ?? 'e2e-owner@spendscope.test';
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-passw0rd-123';

/** Registers the account if it does not exist yet. Idempotent. */
async function ensureAccount(page: Page): Promise<void> {
  const registration = await page.request.post('/api/v1/auth/register', {
    data: { email: E2E_EMAIL, name: 'E2E Owner', password: E2E_PASSWORD },
  });
  // 201 created, or 409 when a previous run already registered it.
  expect([201, 409]).toContain(registration.status());
}

/** Signs in through the real endpoint (registering the account first if needed). */
export async function signIn(page: Page): Promise<void> {
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: E2E_EMAIL, password: E2E_PASSWORD },
  });

  if (response.status() === 401) {
    await ensureAccount(page);
    const retry = await page.request.post('/api/v1/auth/login', {
      data: { email: E2E_EMAIL, password: E2E_PASSWORD },
    });
    expect(retry.status()).toBe(200);
    return;
  }

  expect(response.status()).toBe(200);
}
