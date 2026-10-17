import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';

import {
  createTransactionSchema,
  TRANSACTION_TYPES,
  type CategoryDTO,
  type CreateTransactionInput,
  type TransactionDTO,
} from '@spendscope/shared';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { Label } from '@/components/ui/primitives';
import { errorMessage, validationIssues } from '@/lib/api';
import { REVIEW_STATUS_LABELS, TRANSACTION_TYPE_LABELS } from '@/lib/format';
import { useCreateTransaction, useUpdateTransaction } from '@/features/transactions/queries';

const EMPTY_VALUES: CreateTransactionInput = {
  transactionDate: new Date().toISOString().slice(0, 10),
  description: '',
  merchant: null,
  amount: '',
  type: 'EXPENSE',
  categoryId: null,
  notes: null,
  reviewStatus: 'NEEDS_REVIEW',
};

function toFormValues(transaction: TransactionDTO | null): CreateTransactionInput {
  if (!transaction) return EMPTY_VALUES;
  return {
    transactionDate: transaction.transactionDate,
    description: transaction.description,
    merchant: transaction.merchant,
    amount: transaction.amount,
    type: transaction.type,
    categoryId: transaction.categoryId,
    notes: transaction.notes,
    reviewStatus: transaction.reviewStatus,
  };
}

export interface TransactionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: CategoryDTO[];
  /** `null` creates a new transaction, otherwise the row being edited. */
  transaction: TransactionDTO | null;
}

export function TransactionFormDialog({
  open,
  onOpenChange,
  categories,
  transaction,
}: TransactionFormDialogProps) {
  const createMutation = useCreateTransaction();
  const updateMutation = useUpdateTransaction();
  const isEditing = transaction !== null;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateTransactionInput>({
    resolver: zodResolver(createTransactionSchema),
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (open) reset(toFormValues(transaction));
  }, [open, transaction, reset]);

  const type = watch('type');

  // The category list follows the transaction type: the API rejects a mismatch,
  // so the form never offers an invalid combination in the first place.
  const availableCategories = useMemo(() => {
    if (!type || type === 'TRANSFER') return [];
    const kind = type === 'INCOME' ? 'INCOME' : 'EXPENSE';
    return categories.filter((category) => category.kind === kind);
  }, [categories, type]);

  const mutationError = createMutation.error ?? updateMutation.error;
  const issues = validationIssues(mutationError);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isEditing && transaction) {
        await updateMutation.mutateAsync({ id: transaction.id, input: values });
        toast.success('Transaction updated');
      } else {
        await createMutation.mutateAsync(values);
        toast.success('Transaction created');
      }
      onOpenChange(false);
    } catch {
      // The error is rendered below; keep the dialog open so the user can fix it.
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          createMutation.reset();
          updateMutation.reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit transaction' : 'New transaction'}</DialogTitle>
          <DialogDescription>
            Amounts are always positive; the transaction type decides whether the value counts as income or spending.
          </DialogDescription>
        </DialogHeader>

        {mutationError ? (
          <Alert variant="destructive" title="Could not save">
            <p>{errorMessage(mutationError)}</p>
            {issues.length > 0 ? (
              <ul className="mt-1 list-disc pl-4">
                {issues.map((issue) => (
                  <li key={`${issue.path}-${issue.message}`}>
                    {issue.path}: {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}

        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="transaction-date">Transaction date</Label>
              <Input id="transaction-date" type="date" {...register('transactionDate')} />
              {errors.transactionDate ? (
                <p className="text-xs text-destructive">{errors.transactionDate.message}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="transaction-amount">Amount</Label>
              <Input
                id="transaction-amount"
                inputMode="decimal"
                placeholder="1250.00"
                {...register('amount')}
              />
              {errors.amount ? <p className="text-xs text-destructive">{errors.amount.message}</p> : null}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="transaction-description">Description</Label>
            <Input id="transaction-description" placeholder="Supermarket shopping" {...register('description')} />
            {errors.description ? (
              <p className="text-xs text-destructive">{errors.description.message}</p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="transaction-merchant">Merchant (optional)</Label>
              <Input id="transaction-merchant" placeholder="ShopRite" {...register('merchant')} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="transaction-type">Type</Label>
              <Select id="transaction-type" {...register('type')}>
                {TRANSACTION_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {TRANSACTION_TYPE_LABELS[value]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="transaction-category">Category</Label>
              <Select
                id="transaction-category"
                disabled={type === 'TRANSFER'}
                {...register('categoryId', { setValueAs: (value: string) => (value === '' ? null : value) })}
              >
                <option value="">Uncategorized</option>
                {availableCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
              {type === 'TRANSFER' ? (
                <p className="text-xs text-muted-foreground">
                  Transfers between accounts are excluded from income and expense totals and cannot be categorised.
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="transaction-review">Review status</Label>
              <Select id="transaction-review" {...register('reviewStatus')}>
                <option value="NEEDS_REVIEW">{REVIEW_STATUS_LABELS.NEEDS_REVIEW}</option>
                <option value="REVIEWED">{REVIEW_STATUS_LABELS.REVIEWED}</option>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="transaction-notes">Notes (optional)</Label>
            <Textarea id="transaction-notes" placeholder="Anything you want to remember about this transaction" {...register('notes')} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}>
              {isEditing ? 'Save changes' : 'Create transaction'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
