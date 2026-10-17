import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';

import { createCategorySchema, type CategoryDTO, type CreateCategoryInput } from '@spendscope/shared';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { Label } from '@/components/ui/primitives';
import { useCreateCategory, useUpdateCategory } from '@/features/categories/queries';
import { errorMessage } from '@/lib/api';

const DEFAULT_COLOR = '#0f766e';

export function CategoryFormDialog({
  open,
  onOpenChange,
  category,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: CategoryDTO | null;
}) {
  const createMutation = useCreateCategory();
  const updateMutation = useUpdateCategory();
  const isEditing = category !== null;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateCategoryInput>({
    resolver: zodResolver(createCategorySchema),
    defaultValues: { name: '', kind: 'EXPENSE', color: DEFAULT_COLOR, description: null },
  });

  useEffect(() => {
    if (!open) return;
    reset(
      category
        ? { name: category.name, kind: category.kind, color: category.color ?? DEFAULT_COLOR, description: category.description }
        : { name: '', kind: 'EXPENSE', color: DEFAULT_COLOR, description: null },
    );
  }, [open, category, reset]);

  const color = watch('color') ?? DEFAULT_COLOR;
  const mutationError = createMutation.error ?? updateMutation.error;
  const canChangeKind = !category || category.transactionCount === 0;

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isEditing && category) {
        await updateMutation.mutateAsync({ id: category.id, input: values });
        toast.success('Category updated');
      } else {
        await createMutation.mutateAsync(values);
        toast.success('Category created');
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
          <DialogTitle>{isEditing ? 'Edit category' : 'New category'}</DialogTitle>
          <DialogDescription>
            The classification decides which transactions can use the category: income categories only accept income,
            expense categories accept expenses and refunds.
          </DialogDescription>
        </DialogHeader>

        {mutationError ? (
          <Alert variant="destructive" title="Could not save">
            {errorMessage(mutationError)}
          </Alert>
        ) : null}

        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-name">Name</Label>
            <Input id="category-name" placeholder="Pets" {...register('name')} />
            {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category-kind">Classification</Label>
              <Select id="category-kind" disabled={!canChangeKind} {...register('kind')}>
                <option value="EXPENSE">Expense</option>
                <option value="INCOME">Income</option>
              </Select>
              {!canChangeKind ? (
                <p className="text-xs text-muted-foreground">
                  The classification cannot change while transactions are assigned to this category.
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category-color">Colour</Label>
              <div className="flex items-center gap-2">
                <span
                  className="size-9 shrink-0 rounded-md border border-border"
                  style={{ background: color }}
                  aria-hidden="true"
                />
                <input
                  id="category-color"
                  type="color"
                  className="h-9 w-16 cursor-pointer rounded-md border border-input bg-background p-1"
                  value={color}
                  onChange={(event) => setValue('color', event.target.value, { shouldValidate: true })}
                />
                <Input
                  aria-label="Colour hex value"
                  placeholder="#0f766e"
                  value={color}
                  onChange={(event) => setValue('color', event.target.value, { shouldValidate: true })}
                />
              </div>
              {errors.color ? <p className="text-xs text-destructive">{errors.color.message}</p> : null}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="category-description">Description (optional)</Label>
            <Textarea id="category-description" placeholder="Used for veterinary bills and pet food" {...register('description')} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}>
              {isEditing ? 'Save changes' : 'Create category'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
