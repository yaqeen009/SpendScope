import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Eye, MoreHorizontal, Pencil, Plus, Receipt, Trash2 } from 'lucide-react';

import type { TransactionDTO } from '@spendscope/shared';

import { Amount, TypeBadge } from '@/components/common/amount';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Pagination } from '@/components/common/pagination';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TooltipHint } from '@/components/ui/controls';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState, ErrorState, LoadingState, Skeleton } from '@/components/ui/feedback';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCategories } from '@/features/categories/queries';
import { EMPTY_FILTERS, TransactionFilterBar, hasActiveFilters, type TransactionFilters } from '@/features/transactions/filters';
import { TransactionDetailDialog } from '@/features/transactions/transaction-detail-dialog';
import { TransactionFormDialog } from '@/features/transactions/transaction-form-dialog';
import {
  useDeleteTransaction,
  useTransactions,
  useUpdateTransaction,
  type TransactionListParams,
} from '@/features/transactions/queries';
import { errorMessage } from '@/lib/api';
import { REVIEW_STATUS_LABELS, TRANSACTION_TYPE_LABELS } from '@/lib/format';
import { useMoney } from '@/hooks/use-money';

const PAGE_SIZE = 20;

function filtersFromParams(params: URLSearchParams): TransactionFilters {
  return {
    search: params.get('search') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    categoryId: params.get('categoryId') ?? '',
    type: params.get('type') ?? '',
    reviewStatus: params.get('reviewStatus') ?? '',
    sortBy: (params.get('sortBy') as TransactionFilters['sortBy']) ?? 'date',
    sortOrder: (params.get('sortOrder') as TransactionFilters['sortOrder']) ?? 'desc',
  };
}

export function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { formatMoney, formatDate } = useMoney();

  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);

  const categoriesQuery = useCategories();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TransactionDTO | null>(null);
  const [detail, setDetail] = useState<TransactionDTO | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TransactionDTO | null>(null);

  const listParams: TransactionListParams = {
    page,
    pageSize: PAGE_SIZE,
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.reviewStatus ? { reviewStatus: filters.reviewStatus } : {}),
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
  };

  const transactionsQuery = useTransactions(listParams);
  const deleteMutation = useDeleteTransaction();
  const updateMutation = useUpdateTransaction();

  const categories = categoriesQuery.data ?? [];
  const result = transactionsQuery.data;

  /** Any filter change resets to page 1 so the user never lands on an empty page. */
  const applyFilters = (next: Partial<TransactionFilters>) => {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value && value !== EMPTY_FILTERS[key as keyof TransactionFilters]) params.set(key, value);
    }
    params.set('page', '1');
    setSearchParams(params, { replace: true });
  };

  const setPage = (nextPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set('page', String(nextPage));
    setSearchParams(params, { replace: true });
  };

  const toggleReviewStatus = async (transaction: TransactionDTO) => {
    try {
      await updateMutation.mutateAsync({
        id: transaction.id,
        input: { reviewStatus: transaction.reviewStatus === 'REVIEWED' ? 'NEEDS_REVIEW' : 'REVIEWED' },
      });
      toast.success(
        transaction.reviewStatus === 'REVIEWED' ? 'Marked as needing review' : 'Marked as reviewed',
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Transactions"
        description="Every transaction in this workspace. Search, filter, edit and review your data."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" />
            New transaction
          </Button>
        }
      />

      <TransactionFilterBar filters={filters} categories={categories} onChange={applyFilters} />

      {transactionsQuery.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <LoadingState label="Loading transactions…" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : null}

      {transactionsQuery.isError ? (
        <ErrorState message={errorMessage(transactionsQuery.error)} onRetry={() => void transactionsQuery.refetch()} />
      ) : null}

      {result && result.data.length === 0 ? (
        <EmptyState
          icon={<Receipt className="size-8" />}
          title={hasActiveFilters(filters) ? 'No transactions match these filters' : 'No transactions yet'}
          description={
            hasActiveFilters(filters)
              ? 'Try widening the date range, clearing the category filter or searching for a different term.'
              : 'Add a transaction manually or import a CSV from your bank to get started.'
          }
          action={
            hasActiveFilters(filters) ? (
              <Button variant="outline" onClick={() => applyFilters({ ...EMPTY_FILTERS })}>
                Reset filters
              </Button>
            ) : (
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="size-4" />
                New transaction
              </Button>
            )
          }
        />
      ) : null}

      {result && result.data.length > 0 ? (
        <>
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Review</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.data.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(transaction.transactionDate)}
                    </TableCell>
                    <TableCell className="max-w-[18rem]">
                      <span className="block truncate font-medium">{transaction.description}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {transaction.merchant ?? '—'}
                        {transaction.isSample ? ' · sample data' : transaction.importBatchId ? ' · imported' : ''}
                      </span>
                    </TableCell>
                    <TableCell>
                      <TypeBadge type={transaction.type} label={TRANSACTION_TYPE_LABELS[transaction.type]} />
                    </TableCell>
                    <TableCell>
                      {transaction.category ? (
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="size-2.5 shrink-0 rounded-full border border-border"
                            style={{ background: transaction.category.color ?? 'var(--muted-foreground)' }}
                            aria-hidden="true"
                          />
                          <span className="truncate">{transaction.category.name}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Uncategorized</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Amount type={transaction.type} formatted={formatMoney(transaction.amount)} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={transaction.reviewStatus === 'REVIEWED' ? 'success' : 'warning'}>
                        {REVIEW_STATUS_LABELS[transaction.reviewStatus]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <TooltipHint label="Actions">
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Actions for ${transaction.description}`}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipHint>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setDetail(transaction)}>
                            <Eye className="size-4" />
                            View details
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              setEditing(transaction);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="size-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void toggleReviewStatus(transaction)}>
                            <Receipt className="size-4" />
                            {transaction.reviewStatus === 'REVIEWED' ? 'Mark needs review' : 'Mark reviewed'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setPendingDelete(transaction)}
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Pagination
            page={result.page}
            totalPages={result.totalPages}
            total={result.total}
            pageSize={result.pageSize}
            onPageChange={setPage}
            noun="transactions"
          />
        </>
      ) : null}

      <TransactionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        categories={categories}
        transaction={editing}
      />

      <TransactionDetailDialog
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        transaction={detail}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete this transaction?"
        destructive
        confirmLabel="Delete transaction"
        description={
          <>
            <strong>{pendingDelete?.description}</strong> for {pendingDelete ? formatMoney(pendingDelete.amount) : ''} on{' '}
            {pendingDelete ? formatDate(pendingDelete.transactionDate) : ''} will be permanently removed. This cannot be
            undone.
          </>
        }
        onConfirm={async () => {
          if (!pendingDelete) return;
          await deleteMutation.mutateAsync(pendingDelete.id);
          toast.success('Transaction deleted');
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
