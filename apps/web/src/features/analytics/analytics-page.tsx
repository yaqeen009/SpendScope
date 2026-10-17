import { Link } from 'react-router-dom';

import { CategoryBreakdownChart } from '@/components/charts/category-breakdown-chart';
import { IncomeExpenseChart } from '@/components/charts/income-expense-chart';
import { MonthlyTrendChart } from '@/components/charts/monthly-trend-chart';
import { Amount, CategoryChip } from '@/components/common/amount';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/controls';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PeriodSelector } from '@/features/analytics/period-selector';
import {
  useCategoryBreakdown,
  useLargestExpenses,
  useMonthlyTrend,
  useSummary,
  useTimeSeries,
} from '@/features/analytics/queries';
import { useMoney } from '@/hooks/use-money';
import { usePeriod } from '@/hooks/use-period';
import { errorMessage } from '@/lib/api';
import { TRANSFER_SUPPORT_NOTE } from '@spendscope/shared';

export function AnalyticsPage() {
  const { period, params, setPeriod } = usePeriod('last_3_months');
  const { formatMoney, formatMonth, formatDate } = useMoney();

  const summaryQuery = useSummary(params);
  const timeSeriesQuery = useTimeSeries(params);
  const categoriesQuery = useCategoryBreakdown(params);
  const trendQuery = useMonthlyTrend(params);
  const largestQuery = useLargestExpenses(params);

  const summary = summaryQuery.data;
  const isLoading = summaryQuery.isPending || timeSeriesQuery.isPending || categoriesQuery.isPending;
  const error = summaryQuery.error ?? timeSeriesQuery.error ?? categoriesQuery.error;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Analytics"
        description="Aggregates are computed by the API from your stored transactions. Transfers are excluded."
      >
        <PeriodSelector period={period} onSelect={setPeriod} />
      </PageHeader>

      {isLoading ? <LoadingState label="Calculating analytics…" /> : null}

      {error && !isLoading ? (
        <ErrorState
          message={errorMessage(error)}
          onRetry={() => {
            void summaryQuery.refetch();
            void timeSeriesQuery.refetch();
            void categoriesQuery.refetch();
          }}
        />
      ) : null}

      {summary && !isLoading ? (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="largest">Largest expenses</TabsTrigger>
            <TabsTrigger value="comparison">Period comparison</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricTile label="Income" value={formatMoney(summary.current.income)} />
              <MetricTile label="Expenses" value={formatMoney(summary.current.expenses)} />
              <MetricTile label="Net cash flow" value={formatMoney(summary.current.net)} />
              <MetricTile
                label="Savings rate"
                value={summary.current.savingsRate === null ? 'Not available' : `${(summary.current.savingsRate * 100).toFixed(1)}%`}
                hint="Requires income greater than zero."
              />
            </div>
            {timeSeriesQuery.data ? <IncomeExpenseChart series={timeSeriesQuery.data} /> : null}
            {trendQuery.data ? (
              <MonthlyTrendChart months={trendQuery.data.months} formatMonth={formatMonth} />
            ) : null}
          </TabsContent>

          <TabsContent value="categories" className="flex flex-col gap-4">
            {categoriesQuery.data ? <CategoryBreakdownChart breakdown={categoriesQuery.data} /> : null}
            {categoriesQuery.data && categoriesQuery.data.items.length > 0 ? (
              <TableContainer>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Transactions</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoriesQuery.data.items.map((item) => (
                      <TableRow key={item.categoryId ?? 'uncategorized'}>
                        <TableCell>
                          <CategoryChip name={item.name} color={item.color} />
                        </TableCell>
                        <TableCell className="tabular text-right">{item.transactionCount}</TableCell>
                        <TableCell className="tabular text-right">
                          {(item.share * 100).toFixed(1)}%
                        </TableCell>
                        <TableCell className="tabular text-right font-medium">{formatMoney(item.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <EmptyState
                title="No spending in this period"
                description="Expenses recorded in the selected range will appear here, grouped by category."
              />
            )}
            {summary.current.uncategorizedCount > 0 ? (
              <Alert variant="warning" title={`${summary.current.uncategorizedCount} uncategorized transactions`}>
                {formatMoney(summary.current.uncategorizedExpenseTotal)} of spending in this period has no category.
                Review these in <Link to="/transactions?categoryId=uncategorized">Transactions</Link>.
              </Alert>
            ) : null}
          </TabsContent>

          <TabsContent value="largest" className="flex flex-col gap-4">
            {largestQuery.data && largestQuery.data.length > 0 ? (
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
                    {largestQuery.data.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(row.transactionDate)}
                        </TableCell>
                        <TableCell className="max-w-[18rem] truncate">{row.description}</TableCell>
                        <TableCell>
                          {row.category ? (
                            <CategoryChip name={row.category.name} color={row.category.color} />
                          ) : (
                            <span className="text-muted-foreground">Uncategorized</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Amount type={row.type} formatted={formatMoney(row.amount)} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <EmptyState
                title="No expenses in this period"
                description="The largest individual expenses will be listed here."
              />
            )}
          </TabsContent>

          <TabsContent value="comparison" className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Comparison with the previous period</CardTitle>
                <CardDescription>
                  {summary.previousPeriod
                    ? `${summary.previousPeriod.start} → ${summary.previousPeriod.end} compared with ${period.start} → ${period.end}`
                    : 'Comparison is disabled for this request.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {!summary.previous ? (
                  <p className="text-sm text-muted-foreground">
                    No previous period was calculated for this selection.
                  </p>
                ) : (
                  <TableContainer>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Metric</TableHead>
                          <TableHead className="text-right">Previous</TableHead>
                          <TableHead className="text-right">Current</TableHead>
                          <TableHead className="text-right">Change</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <ComparisonRow label="Income" previous={summary.previous.income} current={summary.current.income} change={summary.change?.income} format={formatMoney} />
                        <ComparisonRow label="Expenses" previous={summary.previous.expenses} current={summary.current.expenses} change={summary.change?.expenses} format={formatMoney} />
                        <ComparisonRow label="Net" previous={summary.previous.net} current={summary.current.net} change={summary.change?.net} format={formatMoney} />
                        <TableRow>
                          <TableCell className="font-medium">Transactions</TableCell>
                          <TableCell className="tabular text-right">{summary.previous.transactionCount}</TableCell>
                          <TableCell className="tabular text-right">{summary.current.transactionCount}</TableCell>
                          <TableCell className="text-right text-muted-foreground">—</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
                <p className="text-xs text-muted-foreground">
                  Percentage changes are omitted when the previous value is zero, because a change from zero has no
                  meaningful percentage.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      ) : null}

      {!isLoading && summary && summary.current.transactionCount === 0 ? (
        <Alert variant="info" title="No transactions in this period">
          Nothing to analyse for {period.start} → {period.end}. Import a CSV or add transactions to see analytics.
        </Alert>
      ) : null}

      <Alert variant="info">{TRANSFER_SUPPORT_NOTE}</Alert>
    </div>
  );
}

function MetricTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

function ComparisonRow({
  label,
  previous,
  current,
  change,
  format,
}: {
  label: string;
  previous: string;
  current: string;
  change: number | null | undefined;
  format: (value: string) => string;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">{label}</TableCell>
      <TableCell className="tabular text-right">{format(previous)}</TableCell>
      <TableCell className="tabular text-right">{format(current)}</TableCell>
      <TableCell className="tabular text-right text-muted-foreground">
        {change === null || change === undefined ? '—' : `${change > 0 ? '+' : ''}${(change * 100).toFixed(1)}%`}
      </TableCell>
    </TableRow>
  );
}
