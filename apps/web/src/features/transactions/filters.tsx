import { Filter, RotateCcw, Search } from 'lucide-react';

import type { CategoryDTO, ReviewStatus, TransactionType } from '@spendscope/shared';

import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Label } from '@/components/ui/primitives';
import { TRANSACTION_TYPES, REVIEW_STATUSES } from '@spendscope/shared';
import { REVIEW_STATUS_LABELS, TRANSACTION_TYPE_LABELS } from '@/lib/format';

export interface TransactionFilters {
  search: string;
  from: string;
  to: string;
  categoryId: string;
  type: string;
  reviewStatus: string;
  sortBy: 'date' | 'amount' | 'description';
  sortOrder: 'asc' | 'desc';
}

export const EMPTY_FILTERS: TransactionFilters = {
  search: '',
  from: '',
  to: '',
  categoryId: '',
  type: '',
  reviewStatus: '',
  sortBy: 'date',
  sortOrder: 'desc',
};

export function hasActiveFilters(filters: TransactionFilters): boolean {
  return Boolean(
    filters.search || filters.from || filters.to || filters.categoryId || filters.type || filters.reviewStatus,
  );
}

export function TransactionFilterBar({
  filters,
  categories,
  onChange,
}: {
  filters: TransactionFilters;
  categories: CategoryDTO[];
  onChange: (next: Partial<TransactionFilters>) => void;
}) {
  const income = categories.filter((category) => category.kind === 'INCOME');
  const expense = categories.filter((category) => category.kind === 'EXPENSE');

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Filter className="size-4 text-muted-foreground" aria-hidden="true" />
        Filters
        {hasActiveFilters(filters) ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => onChange({ ...EMPTY_FILTERS })}
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="filter-search">Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="filter-search"
              value={filters.search}
              onChange={(event) => onChange({ search: event.target.value })}
              placeholder="Description, merchant or notes"
              className="pl-8"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-from">From</Label>
          <Input
            id="filter-from"
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(event) => onChange({ from: event.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-to">To</Label>
          <Input
            id="filter-to"
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(event) => onChange({ to: event.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-category">Category</Label>
          <Select
            id="filter-category"
            value={filters.categoryId}
            onChange={(event) => onChange({ categoryId: event.target.value })}
          >
            <option value="">All categories</option>
            <option value="uncategorized">Uncategorized only</option>
            <optgroup label="Income">
              {income.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Expenses">
              {expense.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-type">Type</Label>
          <Select
            id="filter-type"
            value={filters.type}
            onChange={(event) => onChange({ type: event.target.value })}
          >
            <option value="">All types</option>
            {TRANSACTION_TYPES.map((type: TransactionType) => (
              <option key={type} value={type}>
                {TRANSACTION_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-review">Review status</Label>
          <Select
            id="filter-review"
            value={filters.reviewStatus}
            onChange={(event) => onChange({ reviewStatus: event.target.value })}
          >
            <option value="">Any status</option>
            {REVIEW_STATUSES.map((status: ReviewStatus) => (
              <option key={status} value={status}>
                {REVIEW_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-sort">Sort by</Label>
          <div className="flex gap-2">
            <Select
              id="filter-sort"
              value={filters.sortBy}
              onChange={(event) =>
                onChange({ sortBy: event.target.value as TransactionFilters['sortBy'] })
              }
              className="flex-1"
            >
              <option value="date">Date</option>
              <option value="amount">Amount</option>
              <option value="description">Description</option>
            </Select>
            <Select
              aria-label="Sort direction"
              value={filters.sortOrder}
              onChange={(event) =>
                onChange({ sortOrder: event.target.value as TransactionFilters['sortOrder'] })
              }
              className="w-28"
            >
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
