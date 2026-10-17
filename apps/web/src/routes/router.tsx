import { createBrowserRouter } from 'react-router-dom';
import { lazy } from 'react';

import { AppShell } from '@/components/layout/app-shell';
import { NotFoundPage } from '@/pages/not-found-page';

/**
 * Route pages are code-split so the charting library is only downloaded when a
 * page that uses it is opened. Each lazy import keeps the page's named export.
 */
const DashboardPage = lazy(() =>
  import('@/features/dashboard/dashboard-page').then((module) => ({ default: module.DashboardPage })),
);
const TransactionsPage = lazy(() =>
  import('@/features/transactions/transactions-page').then((module) => ({ default: module.TransactionsPage })),
);
const AnalyticsPage = lazy(() =>
  import('@/features/analytics/analytics-page').then((module) => ({ default: module.AnalyticsPage })),
);
const BudgetsPage = lazy(() =>
  import('@/features/budgets/budgets-page').then((module) => ({ default: module.BudgetsPage })),
);
const CategoriesPage = lazy(() =>
  import('@/features/categories/categories-page').then((module) => ({ default: module.CategoriesPage })),
);
const ImportPage = lazy(() =>
  import('@/features/imports/import-page').then((module) => ({ default: module.ImportPage })),
);
const SettingsPage = lazy(() =>
  import('@/features/settings/settings-page').then((module) => ({ default: module.SettingsPage })),
);

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'transactions', element: <TransactionsPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'budgets', element: <BudgetsPage /> },
      { path: 'categories', element: <CategoriesPage /> },
      { path: 'import', element: <ImportPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
