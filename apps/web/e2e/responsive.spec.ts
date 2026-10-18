import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { signIn } from './auth';

/**
 * Pages must not overflow the viewport horizontally.
 *
 * Two separate causes are pinned here.
 *
 * The dashboard's two cards once sat in a grid track sized `auto`, so the
 * transactions table's min-content width (439px) became the track width and
 * every card in the section inherited it — a 360px phone could be dragged 178px
 * sideways. The section is now `grid-cols-1` (`minmax(0, 1fr)`).
 *
 * The categories page keeps a 60-character name, a nowrap `truncate`
 * description and a nowrap "Default" badge in one table cell. Uncapped that
 * cell's min-content is 389px and the table 763px, against 284px of usable card
 * on a phone: the document was 677px wide at a 360px viewport. The cell is now
 * width-capped, and below `md` the rows render as a list instead of the table.
 *
 * The assertions are measurements — a width, a real scroll attempt and an
 * element sweep — not snapshots, so they fail on the behaviour and not on a
 * pixel.
 */

async function measure(page: Page) {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth;

    // Anything reaching past the viewport and not clipped by a scroll container
    // of its own.
    const unclipped: string[] = [];
    for (const element of Array.from(document.querySelectorAll('main *'))) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right <= viewportWidth + 1) continue;
      let clipped = false;
      for (let node = element.parentElement; node; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') clipped = true;
      }
      if (clipped) continue;
      const classes = (element.getAttribute('class') ?? '').split(/\s+/).slice(0, 4).join('.');
      unclipped.push(`${element.tagName.toLowerCase()}.${classes} right=${Math.round(rect.right)}`);
    }

    window.scrollTo(1000, 0);
    const sidewaysScroll = window.scrollX;
    window.scrollTo(0, 0);

    return { viewportWidth, documentScrollWidth: document.documentElement.scrollWidth, sidewaysScroll, unclipped };
  });
}

function expectFits(report: Awaited<ReturnType<typeof measure>>, label: string): void {
  expect(report.documentScrollWidth, `${label}: document width`).toBeLessThanOrEqual(report.viewportWidth);
  expect(report.sidewaysScroll, `${label}: horizontal scroll position`).toBe(0);
  expect(report.unclipped, `${label}: elements past the viewport`).toEqual([]);
}

/** Which of the two renderings of a table is live: the list, or the table. */
async function rendering(page: Page, root: string) {
  return page.evaluate((selector) => {
    const container = document.querySelector(selector);
    const list = container?.querySelector('ul');
    const table = container?.querySelector('table');
    return {
      listVisible: Boolean(list && list.getBoundingClientRect().height > 0),
      tableVisible: Boolean(table && table.getBoundingClientRect().height > 0),
    };
  }, root);
}

async function importRows(page: Page, stamp: string): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'spendscope-responsive-'));
  const file = path.join(dir, `responsive-${stamp}.csv`);
  await writeFile(
    file,
    [
      'Date,Description,Merchant,Amount,Type,Category,Notes',
      `2026-10-02,Monthly grocery shop at the supermarket downtown ${stamp},Euro Market,412.45,EXPENSE,Groceries and household supplies,e2e`,
      `2026-10-03,Salary payment for September ${stamp},E2E Corp,3200.00,INCOME,Salary,e2e`,
      `2026-10-05,Electricity and gas bill ${stamp},Power Co,148.9,EXPENSE,Utilities,e2e`,
      `2026-10-07,Refund for the returned kettle ${stamp},Euro Market,39.99,REFUND,Groceries and household supplies,e2e`,
      `2026-10-09,Train ticket to the customer meeting ${stamp},Rail,84.5,EXPENSE,Transport,e2e`,
    ].join('\n'),
    'utf8',
  );

  await page.goto('/import');
  await page.setInputFiles('input#import-file', file);
  await page.getByRole('button', { name: /import rows/i }).click();
  await page.getByText('Import complete').waitFor();
}

test('the dashboard fits every viewport without sideways scrolling', async ({ page }) => {
  await signIn(page);
  // Unique per run: identical rows are treated as duplicates and the import
  // button stays disabled.
  await importRows(page, `${Date.now()}`);

  for (const viewport of [
    { width: 360, height: 640, label: '360px phone', table: false },
    { width: 390, height: 844, label: '390px phone', table: false },
    { width: 768, height: 1024, label: '768px tablet', table: true },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    await page.getByRole('heading', { name: 'Recent transactions' }).waitFor();

    expectFits(await measure(page), viewport.label);

    const shown = await rendering(page, '[aria-label="Recent activity"]');
    expect(shown.tableVisible, `${viewport.label}: table is used`).toBe(viewport.table);
    expect(shown.listVisible, `${viewport.label}: compact list is used`).toBe(!viewport.table);
  }
});

test('the categories page fits every viewport without sideways scrolling', async ({ page }) => {
  await signIn(page);

  // The schema allows a 60-character name and a 300-character description, so
  // this is real data at its worst, not a synthetic width.
  const created = await page.request.post('/api/v1/categories', {
    data: {
      name: 'Groceries and household supplies for the whole family'.slice(0, 60),
      kind: 'EXPENSE',
      color: '#16a34a',
      description:
        'Everything bought at the supermarket, including cleaning products, toiletries and the weekly food ' +
        'shop, excluding anything that belongs to the pets category.',
    },
  });
  expect([201, 409]).toContain(created.status());

  for (const viewport of [
    { width: 360, height: 800, label: '360px phone', table: false },
    { width: 640, height: 900, label: '640px small tablet', table: false },
    { width: 768, height: 1024, label: '768px tablet', table: true },
    { width: 1024, height: 900, label: '1024px laptop', table: true },
    { width: 1280, height: 900, label: '1280px desktop', table: true },
    { width: 1536, height: 900, label: '1536px desktop', table: true },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/categories');
    await page.getByRole('heading', { name: 'Expense categories' }).waitFor();

    expectFits(await measure(page), viewport.label);

    const shown = await rendering(page, 'main .grid.grid-cols-1 > div');
    expect(shown.tableVisible, `${viewport.label}: table is used`).toBe(viewport.table);
    expect(shown.listVisible, `${viewport.label}: compact list is used`).toBe(!viewport.table);
  }
});
