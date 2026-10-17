import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';

import { AppShell } from '@/components/layout/app-shell';
import { LoadingState } from '@/components/ui/feedback';
import { RequireAuth } from '@/features/auth/require-auth';
import { NotFoundPage } from '@/pages/not-found-page';

function AuthFallback() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <LoadingState label="Loading…" />
    </div>
  );
}

/**
 * Route pages are code-split so the charting library is only downloaded when a
 * page that uses it is opened. Each lazy import keeps the page's named export.
 */
const SignInPage = lazy(() =>
  import('@/features/auth/sign-in-page').then((module) => ({ default: module.SignInPage })),
);
const SignUpPage = lazy(() =>
  import('@/features/auth/sign-up-page').then((module) => ({ default: module.SignUpPage })),
);
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
const AccountPage = lazy(() =>
  import('@/features/auth/account-page').then((module) => ({ default: module.AccountPage })),
);

export const router = createBrowserRouter([
  {
    path: '/sign-in',
    element: (
      <Suspense fallback={<AuthFallback />}>
        <SignInPage />
      </Suspense>
    ),
  },
  {
    path: '/sign-up',
    element: (
      <Suspense fallback={<AuthFallback />}>
        <SignUpPage />
      </Suspense>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'transactions', element: <TransactionsPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'budgets', element: <BudgetsPage /> },
      { path: 'categories', element: <CategoriesPage /> },
      { path: 'import', element: <ImportPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: 'home', element: <Navigate to="/" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
