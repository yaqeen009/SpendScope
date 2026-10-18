import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Plus, Target, Trash2 } from 'lucide-react';

import type { BudgetDTO } from '@spendscope/shared';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BudgetFormDialog } from '@/features/budgets/budget-form-dialog';
import { BudgetProgressList } from '@/features/budgets/budget-progress';
import { useBudgets, useBudgetProgress, useDeleteBudget } from '@/features/budgets/queries';
import { useCategories } from '@/features/categories/queries';
import { useMoney } from '@/hooks/use-money';
import { errorMessage } from '@/lib/api';
import { BUDGET_STATE_LABELS } from '@/lib/format';

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number) as [number, number];
  const cursor = year * 12 + (month - 1) + delta;
  return `${String(Math.floor(cursor / 12)).padStart(4, '0')}-${String((cursor % 12) + 1).padStart(2, '0')}`;
}

export function BudgetsPage() {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const { formatMoney, formatMonth } = useMoney();

  const categoriesQuery = useCategories();
  const budgetsQuery = useBudgets({ month });
  const progressQuery = useBudgetProgress(month);
  const deleteMutation = useDeleteBudget();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetDTO | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BudgetDTO | null>(null);

  const categories = categoriesQuery.data ?? [];
  const budgets = budgetsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-6 ">
      <PageHeader
        title="Budgets"
        description="Set a total monthly expense budget and per-category limits, then track actual spending against them."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" />
            New budget
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-32 text-center text-sm font-medium">{formatMonth(month)}</span>
          <Button variant="outline" size="icon" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMonth(monthKey(new Date()))}>
            Current month
          </Button>
        </div>
      </PageHeader>

      <Alert variant="info">
        Budget progress counts expense transactions in {formatMonth(month)} and subtracts refunds. Income and internal
        transfers never count towards a budget.
      </Alert>

      {budgetsQuery.isPending ? <LoadingState label="Loading budgets…" /> : null}

      {budgetsQuery.isError ? (
        <ErrorState message={errorMessage(budgetsQuery.error)} onRetry={() => void budgetsQuery.refetch()} />
      ) : null}

      {budgetsQuery.isSuccess ? (
        <div className="grid gap-4 xl:grid-cols-2 grid-cols-1">
          <Card className="">
            <CardHeader>
              <CardTitle>Progress for {formatMonth(month)}</CardTitle>
              <CardDescription>Spending against each budget for this month.</CardDescription>
            </CardHeader>
            <CardContent>
              {progressQuery.data ? (
                <BudgetProgressList progress={progressQuery.data} />
              ) : (
                <LoadingState label="Calculating progress…" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Budgets</CardTitle>
              <CardDescription>
                {budgets.length === 0
                  ? 'No budgets for this month yet.'
                  : `${budgets.length} budget${budgets.length === 1 ? '' : 's'} configured.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {budgets.length === 0 ? (
                <EmptyState
                  icon={<Target className="size-8" />}
                  title="No budgets for this month"
                  description="Create a total monthly budget or one per expense category to track how your spending compares with your plan."
                  action={
                    <Button
                      onClick={() => {
                        setEditing(null);
                        setFormOpen(true);
                      }}
                    >
                      <Plus className="size-4" />
                      New budget
                    </Button>
                  }
                />
              ) : (
                <TableContainer className="relative">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Budget</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Spent</TableHead>
                        <TableHead>Remaining</TableHead>
                        <TableHead className="w-24">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {budgets.map((budget) => {
                        const item = progressQuery.data?.items.find((entry) => entry.budgetId === budget.id);
                        return (
                          <TableRow key={budget.id}>
                            <TableCell className="font-medium">
                              {budget.category?.name ?? 'Total monthly budget'}
                            </TableCell>
                            <TableCell className="tabular text-right">{formatMoney(budget.amount)}</TableCell>
                            <TableCell className="tabular text-right">
                              {item ? formatMoney(item.spent) : '—'}
                            </TableCell>
                            <TableCell>
                              {item ? (
                                <span
                                  className={
                                    item.state === 'exceeded'
                                      ? 'text-destructive'
                                      : item.state === 'warning'
                                        ? 'text-warning-foreground'
                                        : 'text-muted-foreground'
                                  }
                                >
                                  {Number(item.remaining) < 0
                                    ? `${formatMoney(String(Math.abs(Number(item.remaining))))} over`
                                    : `${formatMoney(item.remaining)} · ${BUDGET_STATE_LABELS[item.state]}`}
                                </span>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setEditing(budget);
                                    setFormOpen(true);
                                  }}
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Delete budget for ${budget.category?.name ?? 'this month'}`}
                                  onClick={() => setPendingDelete(budget)}
                                >
                                  <Trash2 className="size-4 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <BudgetFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        categories={categories}
        budget={editing}
        defaultMonth={month}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete this budget?"
        destructive
        confirmLabel="Delete budget"
        description={
          <>
            The {pendingDelete?.category?.name ?? 'total monthly'} budget for{' '}
            {pendingDelete ? formatMonth(pendingDelete.month) : ''} will be removed. Transactions are not affected.
          </>
        }
        onConfirm={async () => {
          if (!pendingDelete) return;
          await deleteMutation.mutateAsync(pendingDelete.id);
          toast.success('Budget deleted');
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
