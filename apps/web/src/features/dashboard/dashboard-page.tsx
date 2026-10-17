import { Link } from 'react-router-dom';
import { ArrowRight, Coins, PiggyBank, Receipt, TrendingDown, Upload, Wallet } from 'lucide-react';
import { formatCurrency } from '@spendscope/shared';

import { CategoryBreakdownChart } from '@/components/charts/category-breakdown-chart';
import { IncomeExpenseChart } from '@/components/charts/income-expense-chart';
import { MonthlyTrendChart } from '@/components/charts/monthly-trend-chart';
import { Amount, CategoryChip } from '@/components/common/amount';
import { StatCard } from '@/components/common/stat-card';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PeriodSelector } from '@/features/analytics/period-selector';
import { BudgetProgressList } from '@/features/budgets/budget-progress';
import { InsightsPanel } from '@/features/dashboard/insights-panel';
import { useDashboard } from '@/features/analytics/queries';
import { useMoney } from '@/hooks/use-money';
import { usePeriod } from '@/hooks/use-period';
import { errorMessage } from '@/lib/api';
import { TRANSACTION_TYPE_LABELS } from '@/lib/format';

export function DashboardPage() {
  const { period, params, setPeriod } = usePeriod('this_month');
  const query = useDashboard(params);
  const { formatMoney, formatMonth, formatDate, locale } = useMoney();

  const dashboard = query.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description="Where your money came from and where it went, for the period you select."
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <PeriodSelector period={period} onSelect={setPeriod} />
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/import">
                <Upload className="size-4" />
                Import CSV
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/transactions">
                <Receipt className="size-4" />
                Add transaction
              </Link>
            </Button>
          </div>
        </div>
      </PageHeader>

      {query.isPending ? <LoadingState label="Loading your dashboard…" /> : null}

      {query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : null}

      {dashboard && dashboard.empty ? (
        <EmptyState
          icon={<Wallet className="size-8" />}
          title="No transactions yet"
          description="Import a CSV from your bank or add your first transaction to see your income, spending and trends. You can also load the clearly-labelled sample dataset from Settings."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link to="/import">
                  <Upload className="size-4" />
                  Import a CSV
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/settings">Load sample data</Link>
              </Button>
            </div>
          }
        />
      ) : null}

      {dashboard && !dashboard.empty ? (
        <>
          {dashboard.recentTransactions.some((row) => row.isSample) ? (
            <Alert variant="info" title="Sample data is included">
              Some transactions in this workspace are labelled sample data. They are fictional and are excluded from
              nothing — remove them from <Link to="/settings">Settings</Link> once you have imported your own data.
            </Alert>
          ) : null}

          {dashboard.summary.current.foreignCurrency.count > 0 ? (
            <Alert variant="warning" title="Some transactions are in another currency">
              {dashboard.summary.current.foreignCurrency.count} transaction
              {dashboard.summary.current.foreignCurrency.count === 1 ? ' is' : 's are'} in{' '}
              {dashboard.summary.current.foreignCurrency.currencies.join(', ')}. SpendScope does not convert
              currencies, so those rows are <strong>not included</strong> in the figures below and are not counted in
              any budget. Excluded:{' '}
              {dashboard.summary.current.foreignCurrency.totals
                .map((entry) => `${formatCurrency(entry.expenses, entry.currency, locale)} expenses`)
                .join(', ')}
              .
            </Alert>
          ) : null}

          <section aria-label="Summary metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Total income"
              value={formatMoney(dashboard.summary.current.income)}
              periodLabel={period.label}
              change={dashboard.summary.change?.income ?? null}
              icon={<Coins className="size-4" />}
              hint="Sum of INCOME transactions in the selected period. Transfers are excluded."
            />
            <StatCard
              label="Total expenses"
              value={formatMoney(dashboard.summary.current.expenses)}
              periodLabel={period.label}
              change={dashboard.summary.change?.expenses ?? null}
              invertChange
              icon={<TrendingDown className="size-4" />}
              hint="Expenses minus refunds in the selected period. Refunds reduce spending rather than counting as income."
            />
            <StatCard
              label="Net cash flow"
              value={formatMoney(dashboard.summary.current.net)}
              periodLabel={period.label}
              change={dashboard.summary.change?.net ?? null}
              accent={Number(dashboard.summary.current.net) >= 0 ? 'success' : 'danger'}
              icon={<Wallet className="size-4" />}
              hint="Income minus expenses. Internal transfers are not counted in either side."
            />
            <StatCard
              label="Savings rate"
              value={
                dashboard.summary.current.savingsRate === null
                  ? 'Not available'
                  : `${(dashboard.summary.current.savingsRate * 100).toFixed(1)}%`
              }
              periodLabel={period.label}
              change={dashboard.summary.change?.savingsRate ?? null}
              icon={<PiggyBank className="size-4" />}
              unavailable={
                dashboard.summary.current.savingsRate === null
                  ? { reason: 'Savings rate needs income greater than zero in this period.' }
                  : undefined
              }
              hint="Net cash flow divided by income. This is a cash-flow ratio, not an investment return."
            />
          </section>

          <section aria-label="Charts" className="grid gap-4 xl:grid-cols-2">
            <IncomeExpenseChart series={dashboard.timeSeries} />
            <CategoryBreakdownChart breakdown={dashboard.categoryBreakdown} />
            <MonthlyTrendChart months={dashboard.monthlyTrend.months} formatMonth={formatMonth} />
            <Card>
              <CardHeader>
                <CardTitle>Budget progress</CardTitle>
                <CardDescription>
                  Spending against the budgets for {formatMonth(dashboard.budgetProgress.month)}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BudgetProgressList progress={dashboard.budgetProgress} />
              </CardContent>
            </Card>
          </section>

          <section aria-label="Recent activity" className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Recent transactions</CardTitle>
                  <CardDescription>The {dashboard.recentTransactions.length} most recent in this period.</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to="/transactions">
                    View all
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {dashboard.recentTransactions.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No transactions in this period.
                  </p>
                ) : (
                  <TableContainer>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dashboard.recentTransactions.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className="whitespace-nowrap text-muted-foreground">
                              {formatDate(row.transactionDate)}
                            </TableCell>
                            <TableCell className="max-w-[16rem] truncate">
                              {row.description}
                              {row.isSample ? <span className="ml-2 text-xs text-muted-foreground">(sample)</span> : null}
                            </TableCell>
                            <TableCell>
                              {row.category ? (
                                <CategoryChip name={row.category.name} color={row.category.color} />
                              ) : (
                                <span className="text-muted-foreground">Uncategorized</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <Amount type={row.type} formatted={formatMoney(row.amount)} />
                              <span className="sr-only"> ({TRANSACTION_TYPE_LABELS[row.type]})</span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Insights</CardTitle>
                <CardDescription>Calculated from this period&rsquo;s totals.</CardDescription>
              </CardHeader>
              <CardContent>
                <InsightsPanel insights={dashboard.insights.insights} />
              </CardContent>
            </Card>
          </section>
        </>
      ) : null}
    </div>
  );
}
