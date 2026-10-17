import type { TransactionType } from '@spendscope/shared';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Amounts are stored as positive magnitudes with an explicit transaction type.
 * The sign shown in the UI is therefore derived from the *type*, never from the
 * stored value.
 */
export function amountSign(type: TransactionType): { prefix: string; className: string } {
  switch (type) {
    case 'INCOME':
      return { prefix: '+', className: 'text-success' };
    case 'EXPENSE':
      return { prefix: '−', className: 'text-foreground' };
    case 'REFUND':
      return { prefix: '+', className: 'text-success' };
    case 'TRANSFER':
      return { prefix: '', className: 'text-muted-foreground' };
  }
}

export function Amount({
  type,
  formatted,
  className,
}: {
  type: TransactionType;
  formatted: string;
  className?: string;
}) {
  const sign = amountSign(type);
  return (
    <span className={cn('tabular font-medium', sign.className, className)}>
      {sign.prefix}
      {formatted}
    </span>
  );
}

/** Colour + label for a transaction type, never colour alone. */
export function TypeBadge({ type, label }: { type: TransactionType; label: string }) {
  const variant = type === 'INCOME' ? 'success' : type === 'TRANSFER' ? 'neutral' : type === 'REFUND' ? 'default' : 'outline';
  return <Badge variant={variant}>{label}</Badge>;
}

export function CategoryChip({
  name,
  color,
}: {
  name: string;
  color?: string | null;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span
        className="size-2.5 shrink-0 rounded-full border border-border"
        style={{ background: color ?? 'var(--muted-foreground)' }}
        aria-hidden="true"
      />
      <span className="truncate">{name}</span>
    </span>
  );
}
