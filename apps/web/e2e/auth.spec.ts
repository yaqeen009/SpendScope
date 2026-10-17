import { expect, test } from '@playwright/test';

import { E2E_EMAIL, E2E_PASSWORD, signIn } from './auth';

/**
 * End-to-end authentication.
 *
 * The browser context starts with no session, so these tests also prove that
 * the route guard and the API agree: an anonymous visitor cannot reach any
 * data page, and the API refuses anonymous data requests.
 */

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

test.beforeAll(async () => {
  // Provision the shared end-to-end account before the UI sign-in flow runs.
  const response = await fetch(`${API_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: E2E_EMAIL, name: 'E2E Owner', password: E2E_PASSWORD }),
  });
  expect([201, 409]).toContain(response.status);
});

test('an anonymous visitor is redirected to the sign-in screen', async ({ page }) => {
  await page.goto('/transactions');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('the API refuses anonymous data requests', async ({ page }) => {
  const response = await page.request.get('/api/v1/transactions');
  expect(response.status()).toBe(401);
  expect((await response.json()).error.code).toBe('UNAUTHORIZED');
});

test('a wrong password shows an error and does not sign in', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(E2E_EMAIL);
  await page.getByLabel('Password').fill('definitely-not-the-passw0rd');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText('Could not sign in')).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('signing in reaches the overview and signing out ends the session', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(E2E_EMAIL);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The overview renders the signed-in workspace, not the sign-in screen.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expect(page).toHaveURL(/\/sign-in$/);

  // The session is really gone at the API level too.
  const response = await page.request.get('/api/v1/transactions');
  expect(response.status()).toBe(401);
});

test('a signed-in user can view the account page', async ({ page }) => {
  await signIn(page);
  await page.goto('/account');
  await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
  await expect(page.getByText(E2E_EMAIL)).toBeVisible();
});
