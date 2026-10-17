import type { BudgetProgressDTO, BudgetProgressItem } from '@spendscope/shared';

import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/controls';
import { BUDGET_STATE_LABELS } from '@/lib/format';
import { useMoney } from '@/hooks/use-money';
import { cn } from '@/lib/utils';

const STATE_BADGE: Record<BudgetProgressItem['state'], 'success' | 'warning' | 'danger'> = {
  ok: 'success',
  warning: 'warning',
  exceeded: 'danger',
};

const STATE_BAR: Record<BudgetProgressItem['state'], string> = {
  ok: 'bg-success',
  warning: 'bg-warning',
  exceeded: 'bg-destructive',
};

export function BudgetProgressRow({ item }: { item: BudgetProgressItem }) {
  const { formatMoney, formatPercent } = useMoney();
  // The bar is clamped at 100%; the label states the true percentage.
  const fraction = Number.isFinite(item.percentUsed) ? item.percentUsed : 0;

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          {item.categoryColor ? (
            <span
              className="size-2.5 rounded-full border border-border"
              style={{ background: item.categoryColor }}
              aria-hidden="true"
            />
          ) : null}
          {item.isTotalBudget ? 'Total monthly budget' : (item.categoryName ?? 'Uncategorised')}
        </span>
        <Badge variant={STATE_BADGE[item.state]} className="ml-auto">
          {BUDGET_STATE_LABELS[item.state]}
        </Badge>
      </div>

      <Progress
        value={fraction}
        indicatorClassName={STATE_BAR[item.state]}
        aria-label={`${item.categoryName ?? 'Total'} budget used`}
      />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="tabular">
          <span className="font-medium text-foreground">{formatMoney(item.spent)}</span> of{' '}
          {formatMoney(item.budgetAmount)} spent
          {fraction > 1 ? <span className="ml-1 text-destructive">({formatPercent(fraction)} used)</span> : null}
        </span>
        <span className="tabular">
          {Number(item.remaining) < 0
            ? `${formatMoney(String(Math.abs(Number(item.remaining))))} over budget`
            : `${formatMoney(item.remaining)} remaining`}
        </span>
      </div>
    </li>
  );
}

export function BudgetProgressList({ progress }: { progress: BudgetProgressDTO }) {
  if (progress.items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No budgets set for this month. Create one on the Budgets page to track your spending.
      </p>
    );
  }

  return (
    <ul className={cn('divide-y divide-border')}>
      {progress.items.map((item) => (
        <BudgetProgressRow key={item.budgetId} item={item} />
      ))}
    </ul>
  );
}
