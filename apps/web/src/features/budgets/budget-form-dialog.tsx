import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';

import { createBudgetSchema, type BudgetDTO, type CategoryDTO, type CreateBudgetInput } from '@spendscope/shared';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/field';
import { Label } from '@/components/ui/primitives';
import { useCreateBudget, useUpdateBudget } from '@/features/budgets/queries';
import { errorMessage } from '@/lib/api';

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

export interface BudgetFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: CategoryDTO[];
  /** `null` creates a new budget, otherwise the budget being edited. */
  budget: BudgetDTO | null;
  defaultMonth: string;
}

export function BudgetFormDialog({ open, onOpenChange, categories, budget, defaultMonth }: BudgetFormDialogProps) {
  const createMutation = useCreateBudget();
  const updateMutation = useUpdateBudget();
  const isEditing = budget !== null;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateBudgetInput>({
    resolver: zodResolver(createBudgetSchema),
    defaultValues: { month: defaultMonth || currentMonthKey(), amount: '', categoryId: null },
  });

  useEffect(() => {
    if (!open) return;
    reset(
      budget
        ? { month: budget.month, amount: budget.amount, categoryId: budget.categoryId }
        : { month: defaultMonth || currentMonthKey(), amount: '', categoryId: null },
    );
  }, [open, budget, defaultMonth, reset]);

  const expenseCategories = categories.filter((category) => category.kind === 'EXPENSE');
  const mutationError = createMutation.error ?? updateMutation.error;

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isEditing && budget) {
        await updateMutation.mutateAsync({ id: budget.id, input: values });
        toast.success('Budget updated');
      } else {
        await createMutation.mutateAsync(values);
        toast.success('Budget created');
      }
      onOpenChange(false);
    } catch {
      /* Rendered below. */
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
          <DialogTitle>{isEditing ? 'Edit budget' : 'New budget'}</DialogTitle>
          <DialogDescription>
            Leave the category empty to set the single total monthly expense budget for that month.
          </DialogDescription>
        </DialogHeader>

        {mutationError ? (
          <Alert variant="destructive" title="Could not save">
            {errorMessage(mutationError)}
          </Alert>
        ) : null}

        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="budget-month">Month</Label>
              <Input id="budget-month" type="month" {...register('month')} />
              {errors.month ? <p className="text-xs text-destructive">{errors.month.message}</p> : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="budget-amount">Budget amount</Label>
              <Input id="budget-amount" inputMode="decimal" placeholder="2000.00" {...register('amount')} />
              {errors.amount ? <p className="text-xs text-destructive">{errors.amount.message}</p> : null}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="budget-category">Category</Label>
            <Select
              id="budget-category"
              {...register('categoryId', { setValueAs: (value: string) => (value === '' ? null : value) })}
            >
              <option value="">Total monthly budget (all expense categories)</option>
              {expenseCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Only expense categories can have a budget. Income categories are not offered.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}>
              {isEditing ? 'Save changes' : 'Create budget'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
