import { useState } from 'react';
import { toast } from 'sonner';

import type { CategoryDTO } from '@spendscope/shared';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { Label } from '@/components/ui/primitives';
import { useDeleteCategory } from '@/features/categories/queries';
import { errorMessage } from '@/lib/api';
import { pluralise } from '@/lib/format';

type Strategy = 'block' | 'uncategorize' | 'reassign';

/**
 * Deleting a category that still has transactions requires an explicit choice:
 * keep the transactions uncategorised or move them onto another category of the
 * same kind. The API refuses the delete unless a strategy is supplied.
 */
export function CategoryDeleteDialog({
  open,
  onOpenChange,
  category,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: CategoryDTO;
  categories: CategoryDTO[];
}) {
  const deleteMutation = useDeleteCategory();
  const [strategy, setStrategy] = useState<Strategy>('uncategorize');
  const [reassignTo, setReassignTo] = useState('');

  // Reassigning can only target another category of the same classification.
  const targets = categories.filter(
    (entry) => entry.id !== category.id && entry.kind === category.kind,
  );

  const needsTarget = category.transactionCount > 0;
  const blocked = needsTarget && strategy === 'reassign' && reassignTo === '';

  const onConfirm = async () => {
    try {
      const result = await deleteMutation.mutateAsync({
        id: category.id,
        strategy: needsTarget ? strategy : 'block',
        ...(needsTarget && strategy === 'reassign' ? { reassignTo } : {}),
      });
      toast.success(
        result.reassigned > 0
          ? `Category deleted · ${pluralise(result.reassigned, 'transaction')} reassigned`
          : result.uncategorized > 0
            ? `Category deleted · ${pluralise(result.uncategorized, 'transaction')} now uncategorised`
            : 'Category deleted',
      );
      onOpenChange(false);
    } catch {
      /* Rendered below. */
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) deleteMutation.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{category.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            {needsTarget
              ? `${pluralise(category.transactionCount, 'transaction')} still use this category. Choose what should happen to them.`
              : 'No transactions use this category. Deleting it cannot be undone.'}
          </DialogDescription>
        </DialogHeader>

        {deleteMutation.error ? (
          <Alert variant="destructive" title="Could not delete">
            {errorMessage(deleteMutation.error)}
          </Alert>
        ) : null}

        {needsTarget ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="delete-strategy">What should happen to the transactions?</Label>
              <Select
                id="delete-strategy"
                value={strategy}
                onChange={(event) => setStrategy(event.target.value as Strategy)}
              >
                <option value="uncategorize">Keep them, but leave them uncategorised</option>
                <option value="reassign">Move them to another category</option>
              </Select>
            </div>

            {strategy === 'reassign' ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="delete-target">Move transactions to</Label>
                <Select
                  id="delete-target"
                  value={reassignTo}
                  onChange={(event) => setReassignTo(event.target.value)}
                >
                  <option value="">Select a category…</option>
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name}
                    </option>
                  ))}
                </Select>
                {targets.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    There is no other {category.kind.toLowerCase()} category to move these transactions to.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleteMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={deleteMutation.isPending || blocked}
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete category'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
