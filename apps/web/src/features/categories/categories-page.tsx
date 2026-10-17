import { useState } from 'react';
import { Plus, Tags } from 'lucide-react';

import type { CategoryDTO } from '@spendscope/shared';

import { CategoryChip } from '@/components/common/amount';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CategoryDeleteDialog } from '@/features/categories/category-delete-dialog';
import { CategoryFormDialog } from '@/features/categories/category-form-dialog';
import { useCategories } from '@/features/categories/queries';
import { useMoney } from '@/hooks/use-money';
import { errorMessage } from '@/lib/api';
import { pluralise } from '@/lib/format';

export function CategoriesPage() {
  const query = useCategories();
  const { formatMoney } = useMoney();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryDTO | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CategoryDTO | null>(null);

  const categories = query.data ?? [];
  const income = categories.filter((category) => category.kind === 'INCOME');
  const expense = categories.filter((category) => category.kind === 'EXPENSE');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Categories"
        description="Income and expense categories classify every transaction. The classification decides which transactions a category can be used for."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" />
            New category
          </Button>
        }
      />

      <Alert variant="info">
        Lifetime totals exclude transfers and subtract refunds from expense categories. Deleting a category never deletes
        the transactions in it.
      </Alert>

      {query.isPending ? <LoadingState label="Loading categories…" /> : null}

      {query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : null}

      {query.isSuccess && categories.length === 0 ? (
        <EmptyState
          icon={<Tags className="size-8" />}
          title="No categories yet"
          description="Create a category to classify your income and expenses. Default categories are seeded when the workspace is first created."
          action={
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" />
              New category
            </Button>
          }
        />
      ) : null}

      {query.isSuccess && categories.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <CategoryGroup
            title="Expense categories"
            description="Used for expenses and refunds."
            categories={expense}
            formatMoney={formatMoney}
            onEdit={(category) => {
              setEditing(category);
              setFormOpen(true);
            }}
            onDelete={setPendingDelete}
          />
          <CategoryGroup
            title="Income categories"
            description="Used for income only."
            categories={income}
            formatMoney={formatMoney}
            onEdit={(category) => {
              setEditing(category);
              setFormOpen(true);
            }}
            onDelete={setPendingDelete}
          />
        </div>
      ) : null}

      <CategoryFormDialog open={formOpen} onOpenChange={setFormOpen} category={editing} />

      {pendingDelete ? (
        <CategoryDeleteDialog
          open={pendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          category={pendingDelete}
          categories={categories}
        />
      ) : null}
    </div>
  );
}

function CategoryGroup({
  title,
  description,
  categories,
  formatMoney,
  onEdit,
  onDelete,
}: {
  title: string;
  description: string;
  categories: CategoryDTO[];
  formatMoney: (value: string) => string;
  onEdit: (category: CategoryDTO) => void;
  onDelete: (category: CategoryDTO) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {categories.length === 0 ? `No ${title.toLowerCase()} yet.` : description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {categories.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing here yet.</p>
        ) : (
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="text-right">Lifetime</TableHead>
                  <TableHead className="w-24">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <CategoryChip name={category.name} color={category.color} />
                        {category.isDefault ? <Badge variant="neutral">Default</Badge> : null}
                      </div>
                      {category.description ? (
                        <p className="mt-0.5 max-w-[16rem] truncate text-xs text-muted-foreground">
                          {category.description}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular text-right text-muted-foreground">
                      {pluralise(category.transactionCount, 'txn', 'txns')}
                    </TableCell>
                    <TableCell className="tabular text-right font-medium">
                      {formatMoney(category.lifetimeTotal)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => onEdit(category)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => onDelete(category)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}
