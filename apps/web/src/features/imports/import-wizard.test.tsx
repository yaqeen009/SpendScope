import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ImportCommitResultDTO, ImportPreviewDTO, SettingsDTO } from '@spendscope/shared';

import { ImportWizard } from '@/features/imports/import-wizard';
import { jsonResponse, renderWithProviders, route, stubApi, type ApiHandler } from '@/test/test-utils';

const settings: SettingsDTO = {
  workspaceId: 'workspace-1',
  currency: 'GHS',
  locale: 'en-GH',
  theme: 'system',
  defaultPeriod: 'this_month',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

function preview(overrides: Partial<ImportPreviewDTO> = {}): ImportPreviewDTO {
  return {
    previewId: 'preview-1',
    status: 'ready',
    filename: 'statement.csv',
    fileSizeBytes: 128,
    detection: {
      headers: ['Date', 'Description', 'Amount'],
      sampleRows: [{ Date: '2026-10-01', Description: 'Monthly rent', Amount: '1800.00' }],
      rowCount: 1,
      delimiter: ',',
      hasBom: false,
      suggestedMapping: { date: 'Date', description: 'Description', amount: 'Amount' },
    },
    mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
    summary: { total: 1, valid: 1, invalid: 0, duplicatesExact: 0, duplicatesPossible: 0, uncategorized: 1 },
    rows: [
      {
        rowIndex: 0,
        transactionDate: '2026-10-01',
        description: 'Monthly rent',
        merchant: 'Ridge Apartments',
        amount: '1800.00',
        type: 'EXPENSE',
        categoryName: null,
        notes: null,
        suggestedCategoryId: 'cat-housing',
        suggestedCategoryName: 'Housing',
        status: 'valid',
        errors: [],
        duplicateOfId: null,
      },
    ],
    rowsTruncated: false,
    expiresAt: '2026-10-17T12:00:00.000Z',
    warnings: [],
    ...overrides,
  };
}

const commitResult: ImportCommitResultDTO = {
  batch: {
    id: 'batch-1',
    filename: 'statement.csv',
    status: 'COMPLETED',
    totalRows: 1,
    createdRows: 1,
    duplicateRows: 0,
    invalidRows: 0,
    skippedRows: 0,
    source: 'csv',
    notes: null,
    createdAt: '2026-10-17T10:00:00.000Z',
    completedAt: '2026-10-17T10:00:00.000Z',
  },
  created: 1,
  skippedDuplicates: 0,
  rejected: 0,
  total: 1,
  errors: [],
};

const categories = [
  {
    id: 'cat-housing',
    name: 'Housing',
    kind: 'EXPENSE',
    color: '#b45309',
    description: null,
    isDefault: true,
    createdAt: '',
    updatedAt: '',
    transactionCount: 1,
    lifetimeTotal: '1800.00',
  },
];

function baseHandlers(): ApiHandler[] {
  return [route('/settings', { data: settings }), route('/categories', { data: categories })];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function uploadCsv(user: ReturnType<typeof userEvent.setup>) {
  const file = new File(['Date,Description,Amount\n2026-10-01,Monthly rent,1800.00\n'], 'statement.csv', {
    type: 'text/csv',
  });
  await user.upload(screen.getByLabelText('CSV file'), file);
}

describe('ImportWizard', () => {
  it('walks from upload to a completed import', async () => {
    const user = userEvent.setup();
    stubApi([
      ...baseHandlers(),
      route('/imports/preview', { data: preview() }),
      (url, init) => (url.endsWith('/imports') && init?.method === 'POST' ? jsonResponse({ data: commitResult }) : undefined),
    ]);

    renderWithProviders(<ImportWizard />);

    await uploadCsv(user);

    // Review stage shows what will be imported.
    expect(await screen.findByText('Import rows')).toBeInTheDocument();
    expect(screen.getByText('Monthly rent')).toBeInTheDocument();
    expect(screen.getAllByText(/1,800\.00/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /import rows/i }));

    expect(await screen.findByText('Import complete')).toBeInTheDocument();
    expect(screen.getByText(/1 transaction imported/)).toBeInTheDocument();
  });

  it('asks for a column mapping when the file cannot be auto-detected', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const handlers: ApiHandler[] = [
      ...baseHandlers(),
      (url) => {
        if (!url.includes('/imports/preview')) return undefined;
        calls += 1;
        if (calls === 1) {
          return jsonResponse({
            data: preview({
              status: 'mapping_required',
              summary: null,
              rows: [],
              mapping: null,
              detection: {
                headers: ['d', 'desc', 'amt'],
                sampleRows: [{ d: '2026-10-01', desc: 'Monthly rent', amt: '1800.00' }],
                rowCount: 1,
                delimiter: ',',
                hasBom: false,
                suggestedMapping: { date: 'd', description: 'desc', amount: 'amt' },
              },
            }),
          });
        }
        return jsonResponse({ data: preview() });
      },
    ];
    stubApi(handlers);

    renderWithProviders(<ImportWizard />);

    await uploadCsv(user);

    expect(await screen.findByText(/Map columns/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Date/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /validate rows/i }));

    expect(await screen.findByText('Import rows')).toBeInTheDocument();
  });

  it('explains that the file is parsed locally and stays on the machine', () => {
    stubApi(baseHandlers());
    renderWithProviders(<ImportWizard />);
    expect(screen.getByText(/Nothing leaves your machine/)).toBeInTheDocument();
  });
});
