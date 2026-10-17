import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { TooltipHint } from '@/components/ui/controls';
import { cn } from '@/lib/utils';

export interface StatCardProps {
  label: string;
  value: string;
  /** Period the figure covers, e.g. "Mar 2026". */
  periodLabel: string;
  change?: number | null;
  /** When true a *decrease* is good (expenses), when false an increase is good. */
  invertChange?: boolean;
  hint?: string;
  icon?: ReactNode;
  accent?: 'default' | 'success' | 'danger';
  unavailable?: { reason: string };
}

function ChangeIndicator({ change, invert }: { change: number; invert: boolean }) {
  const flat = Math.abs(change) < 0.0005;
  const rising = change > 0;
  // "Good" depends on the metric: rising income is good, rising expenses is not.
  const good = flat ? null : invert ? !rising : rising;
  const Icon = flat ? Minus : rising ? ArrowUpRight : ArrowDownRight;
  const percent = `${rising ? '+' : ''}${(change * 100).toFixed(1)}%`;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        good === null && 'text-muted-foreground',
        good === true && 'text-success',
        good === false && 'text-destructive',
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span>{percent}</span>
      <span className="sr-only">versus the previous period</span>
    </span>
  );
}

/**
 * A single metric tile. Figures always come from the API; the comparison label
 * states the period covered so a number is never presented without context.
 */
export function StatCard({
  label,
  value,
  periodLabel,
  change = null,
  invertChange = false,
  hint,
  icon,
  accent = 'default',
  unavailable,
}: StatCardProps) {
  const content = (
    <Card className="flex h-full flex-col gap-2 p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {icon ? <span className="text-muted-foreground" aria-hidden="true">{icon}</span> : null}
      </div>

      {unavailable ? (
        <p className="text-lg font-semibold text-muted-foreground">Not available</p>
      ) : (
        <p
          className={cn(
            'tabular text-2xl font-semibold tracking-tight',
            accent === 'success' && 'text-success',
            accent === 'danger' && 'text-destructive',
          )}
        >
          {value}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{periodLabel}</span>
        {!unavailable && change !== null ? (
          <>
            <span aria-hidden="true">•</span>
            <ChangeIndicator change={change} invert={invertChange} />
          </>
        ) : null}
      </div>

      {unavailable ? <p className="text-xs text-muted-foreground">{unavailable.reason}</p> : null}
    </Card>
  );

  if (!hint) return content;
  return <TooltipHint label={hint}>{content}</TooltipHint>;
}
