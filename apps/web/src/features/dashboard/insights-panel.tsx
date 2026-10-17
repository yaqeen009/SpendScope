import { AlertTriangle, Info, TrendingUp } from 'lucide-react';

import type { Insight } from '@spendscope/shared';

import { cn } from '@/lib/utils';

const SEVERITY_STYLES: Record<Insight['severity'], { icon: typeof Info; className: string; label: string }> = {
  positive: { icon: TrendingUp, className: 'text-success', label: 'Positive' },
  warning: { icon: AlertTriangle, className: 'text-warning-foreground', label: 'Attention' },
  info: { icon: Info, className: 'text-muted-foreground', label: 'Observation' },
};

/**
 * Deterministic, rule-based observations about the selected period. Each one is
 * a plain calculation over the period totals — there is no machine learning and
 * no external service involved.
 */
export function InsightsPanel({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No observations for this period yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {insights.map((insight) => {
        const style = SEVERITY_STYLES[insight.severity];
        return (
          <li key={insight.id} className="flex gap-3">
            <style.icon className={cn('mt-0.5 size-4 shrink-0', style.className)} aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                <span className="sr-only">{style.label}: </span>
                {insight.title}
              </p>
              <p className="text-sm text-muted-foreground">{insight.detail}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
