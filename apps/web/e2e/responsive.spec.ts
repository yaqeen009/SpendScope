import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { signIn } from './auth';

/**
 * The dashboard must not overflow the viewport horizontally.
 *
 * Both cards in "Recent activity" once sat in a grid track sized `auto`, so the
 * table's min-content width (439px) became the track width and every card in the
 * section inherited it — a 360px phone could be dragged 178px sideways. The
 * table itself cannot fit 286px, so below `sm` the rows render as a compact list
 * and the table is used from `sm` up. These assertions are what keep that true:
 * a width, a scroll attempt and an element-level sweep, not a snapshot.
 */

const VIEWPORTS = [
  { width: 360, height: 640, label: '360px phone', expectsTable: false },
  { width: 390, height: 844, label: '390px phone', expectsTable: false },
  { width: 768, height: 1024, label: '768px tablet', expectsTable: true },
];

async function importRows(page: Parameters<typeof signIn>[0], stamp: string): Promise<void> {
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

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    await page.getByRole('heading', { name: 'Recent transactions' }).waitFor();

    const report = await page.evaluate(() => {
      const viewportWidth = window.innerWidth;

      // Anything reaching past the viewport and not clipped by a scroll
      // container of its own.
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
        unclipped.push(
          `${element.tagName.toLowerCase()}.${classes} right=${Math.round(rect.right)} width=${Math.round(rect.width)}`,
        );
      }

      window.scrollTo(1000, 0);
      const sidewaysScroll = window.scrollX;
      window.scrollTo(0, 0);

      const table = document.querySelector('[aria-label="Recent activity"] table');
      const list = document.querySelector('[aria-label="Recent activity"] ul');
      const tableVisible = Boolean(table && table.getBoundingClientRect().height > 0);
      const listVisible = Boolean(list && list.getBoundingClientRect().height > 0);

      return {
        viewportWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        sidewaysScroll,
        unclipped,
        tableVisible,
        listVisible,
      };
    });

    expect(report.documentScrollWidth, `${viewport.label}: document width`).toBeLessThanOrEqual(
      report.viewportWidth,
    );
    expect(report.sidewaysScroll, `${viewport.label}: horizontal scroll position`).toBe(0);
    expect(report.unclipped, `${viewport.label}: elements past the viewport`).toEqual([]);

    if (viewport.expectsTable) {
      expect(report.tableVisible, `${viewport.label}: table is used`).toBe(true);
      expect(report.listVisible, `${viewport.label}: compact list is not used`).toBe(false);
    } else {
      expect(report.listVisible, `${viewport.label}: compact list is used`).toBe(true);
      expect(report.tableVisible, `${viewport.label}: table is not used`).toBe(false);
    }
  }
});
