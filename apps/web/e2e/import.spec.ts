import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * End-to-end CSV import.
 *
 * These tests exercise the real stack (Vite dev server -> Express API -> local
 * PostgreSQL). Each run writes a CSV with a unique description and amount so
 * reruns are not treated as duplicate imports.
 */

let fixtureDir: string;
let validCsv: string;
let invalidCsv: string;

test.beforeAll(async () => {
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'spendscope-e2e-'));
  const stamp = Date.now();

  validCsv = path.join(fixtureDir, `valid-${stamp}.csv`);
  await writeFile(
    validCsv,
    [
      'Date,Description,Merchant,Amount,Type,Category,Notes',
      `2026-10-02,E2E groceries ${stamp},E2E Mart,${(stamp % 900) + 100}.45,EXPENSE,Groceries,imported by e2e`,
      `2026-10-03,E2E salary ${stamp},E2E Corp,${(stamp % 500) + 2000}.00,INCOME,Salary,imported by e2e`,
    ].join('\n'),
    'utf8',
  );

  invalidCsv = path.join(fixtureDir, `invalid-${stamp}.csv`);
  await writeFile(
    invalidCsv,
    ['Date,Description,Amount', '2026-10-04,Broken amount row,not-a-number'].join('\n'),
    'utf8',
  );
});

test('imports a valid CSV through the wizard', async ({ page }) => {
  await page.goto('/import');

  await expect(page.getByRole('heading', { name: 'Import CSV' })).toBeVisible();

  await page.setInputFiles('input#import-file', validCsv);

  // Review stage: rows are listed and the import can proceed.
  await expect(page.getByRole('button', { name: /import rows/i })).toBeVisible();
  await expect(page.getByText(/E2E groceries/)).toBeVisible();

  await page.getByRole('button', { name: /import rows/i }).click();

  await expect(page.getByText('Import complete')).toBeVisible();
  await expect(page.getByText(/transactions? imported/)).toBeVisible();

  // The imported rows are visible in the transactions list.
  await page.getByRole('link', { name: /review imported transactions/i }).click();
  await expect(page.getByText(/E2E groceries/)).toBeVisible();
});

test('reports invalid rows and refuses to import them when blocked', async ({ page }) => {
  await page.goto('/import');

  await page.setInputFiles('input#import-file', invalidCsv);

  await expect(page.getByText(/could not be validated/i)).toBeVisible();

  await page.getByLabel(/if some rows are invalid/i).selectOption('block_on_invalid');

  // Every row is invalid, so there is nothing importable.
  await expect(page.getByText('No importable rows')).toBeVisible();
  await expect(page.getByRole('button', { name: /import rows/i })).toBeDisabled();
});
