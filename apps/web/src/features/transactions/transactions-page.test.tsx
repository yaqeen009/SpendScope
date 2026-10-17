import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Paginated, SettingsDTO, TransactionDTO } from '@spendscope/shared';

import { TransactionsPage } from '@/features/transactions/transactions-page';
import { renderWithProviders, route, stubApi, type ApiHandler } from '@/test/test-utils';

const settings: SettingsDTO = {
  workspaceId: 'workspace-1',
  currency: 'GHS',
  locale: 'en-GH',
  theme: 'system',
  defaultPeriod: 'this_month',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const transaction: TransactionDTO = {
  id: 'txn-1',
  transactionDate: '2026-10-04',
  description: 'Supermarket shopping',
  merchant: 'ShopRite',
  amount: '312.45',
  type: 'EXPENSE',
  categoryId: 'cat-1',
  category: { id: 'cat-1', name: 'Groceries', kind: 'EXPENSE', color: '#16a34a' },
  notes: 'Weekly shop',
  reviewStatus: 'NEEDS_REVIEW',
  importBatchId: null,
  fingerprint: 'abc',
  isSample: false,
  refundOfTransactionId: null,
  transferGroupId: null,
  currency: null,
  createdAt: '2026-10-04T10:00:00.000Z',
  updatedAt: '2026-10-04T10:00:00.000Z',
};

const page: Paginated<TransactionDTO> = {
  data: [transaction],
  page: 1,
  pageSize: 20,
  total: 1,
  totalPages: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function handlers(transactions: Paginated<TransactionDTO>): ApiHandler[] {
  return [
    route('/settings', { data: settings }),
    route('/categories', {
      data: [{ id: 'cat-1', name: 'Groceries', kind: 'EXPENSE', color: '#16a34a', description: null, isDefault: true, createdAt: '', updatedAt: '', transactionCount: 3, lifetimeTotal: '900.00' }],
    }),
    route('/transactions', transactions),
  ];
}

describe('TransactionsPage', () => {
  it('lists transactions returned by the API', async () => {
    stubApi(handlers(page));

    renderWithProviders(<TransactionsPage />);

    expect(await screen.findByText('Supermarket shopping')).toBeInTheDocument();
    expect(screen.getByText(/312\.45/)).toBeInTheDocument();
    expect(screen.getAllByText('Groceries').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0);
  });

  it('shows the empty state with an invitation to add data', async () => {
    stubApi(handlers({ data: [], page: 1, pageSize: 20, total: 0, totalPages: 1 }));

    renderWithProviders(<TransactionsPage />);

    expect(await screen.findByText('No transactions yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /new transaction/i }).length).toBeGreaterThan(0);
  });

  it('records a filter choice in the URL and refetches', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi(handlers(page));

    renderWithProviders(<TransactionsPage />);
    await screen.findByText('Supermarket shopping');

    await user.selectOptions(screen.getByLabelText('Type'), 'INCOME');

    // The filter is applied by refetching the list with the new query string.
    await vi.waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes('type=INCOME'))).toBe(true);
    });
  });
});
