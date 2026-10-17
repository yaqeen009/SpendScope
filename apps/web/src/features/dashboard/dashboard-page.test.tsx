import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DashboardDTO, SettingsDTO } from '@spendscope/shared';

import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { renderWithProviders, route, stubApi } from '@/test/test-utils';

const settings: SettingsDTO = {
  workspaceId: 'workspace-1',
  currency: 'GHS',
  locale: 'en-GH',
  theme: 'system',
  defaultPeriod: 'this_month',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

function dashboardFixture(overrides: Partial<DashboardDTO> = {}): DashboardDTO {
  return {
    summary: {
      period: { key: 'this_month', label: 'Oct 2026', start: '2026-10-01', end: '2026-10-31' },
      previousPeriod: null,
      current: {
        income: '5000.00',
        expenses: '3200.00',
        net: '1800.00',
        savingsRate: 0.36,
        transactionCount: 12,
        uncategorizedExpenseTotal: '0.00',
        uncategorizedCount: 0,
        foreignCurrency: { count: 0, currencies: [], totals: [] },
      },
      previous: null,
      change: null,
      granularity: 'day',
    },
    timeSeries: {
      granularity: 'day',
      range: { start: '2026-10-01', end: '2026-10-31' },
      points: [{ bucket: '2026-10-05', label: '5 Oct', income: '5000.00', expenses: '3200.00', net: '1800.00' }],
    },
    categoryBreakdown: {
      range: { start: '2026-10-01', end: '2026-10-31' },
      total: '3200.00',
      items: [],
    },
    monthlyTrend: {
      range: { start: '2026-05-01', end: '2026-10-31' },
      months: [{ month: '2026-10', income: '5000.00', expenses: '3200.00', net: '1800.00' }],
    },
    recentTransactions: [],
    largestExpenses: [],
    budgetProgress: { month: '2026-10', items: [], total: null },
    insights: { insights: [] },
    empty: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DashboardPage', () => {
  it('shows a loading state and then the summary metrics from the API', async () => {
    stubApi([route('/settings', { data: settings }), route('/analytics/dashboard', { data: dashboardFixture() })]);

    renderWithProviders(<DashboardPage />);

    expect(screen.getByText('Loading your dashboard…')).toBeInTheDocument();

    expect(await screen.findByText('Total income')).toBeInTheDocument();
    expect(screen.getAllByText(/5,000\.00/).length).toBeGreaterThan(0);
    expect(screen.getByText('Total expenses')).toBeInTheDocument();
    expect(screen.getByText('Net cash flow')).toBeInTheDocument();
  });

  it('renders the empty state when the workspace has no transactions', async () => {
    stubApi([
      route('/settings', { data: settings }),
      route('/analytics/dashboard', { data: dashboardFixture({ empty: true }) }),
    ]);

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('No transactions yet')).toBeInTheDocument();
    expect(screen.queryByText('Total income')).not.toBeInTheDocument();
  });

  it('offers a retry when the dashboard request fails', async () => {
    stubApi([
      route('/settings', { data: settings }),
      route('/analytics/dashboard', { error: { code: 'INTERNAL', message: 'Database unavailable' } }, 500),
    ]);

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable');
    await waitFor(() => expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument());
  });

  it('surfaces a savings-rate explanation instead of a fabricated number when income is zero', async () => {
    const fixture = dashboardFixture();
    fixture.summary.current.savingsRate = null;
    fixture.summary.current.income = '0.00';

    stubApi([route('/settings', { data: settings }), route('/analytics/dashboard', { data: fixture })]);

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('Not available')).toBeInTheDocument();
    expect(screen.getByText(/Savings rate needs income greater than zero/)).toBeInTheDocument();
  });
});
