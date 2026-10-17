import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import type { CategoryBreakdownDTO } from '@spendscope/shared';

import { ChartFrame } from '@/components/charts/chart-frame';
import { useMoney } from '@/hooks/use-money';

const FALLBACK_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

export function CategoryBreakdownChart({ breakdown }: { breakdown: CategoryBreakdownDTO }) {
  const { formatMoney, formatPercent } = useMoney();
  const items = breakdown.items;
  const hasData = items.length > 0 && Number(breakdown.total) !== 0;

  return (
    <ChartFrame
      title="Spending by category"
      description="Net expense per category (refunds subtracted). Transfers are excluded."
      hasData={hasData}
      table={{
        caption: 'Expense totals by category',
        headers: ['Category', 'Amount', 'Share', 'Transactions'],
        rows: items.map((item) => [
          item.name,
          formatMoney(item.total),
          formatPercent(item.share),
          item.transactionCount,
        ]),
      }}
      footer={
        hasData ? (
          <ul className="flex flex-col gap-1.5">
            {items.slice(0, 6).map((item, index) => (
              <li key={item.categoryId ?? 'uncategorized'} className="flex items-center gap-2 text-sm">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: item.color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length] }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="tabular text-muted-foreground">{formatPercent(item.share)}</span>
                <span className="tabular w-24 text-right font-medium">{formatMoney(item.total)}</span>
              </li>
            ))}
          </ul>
        ) : null
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={items}
            dataKey="total"
            nameKey="name"
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={2}
            stroke="var(--card)"
          >
            {items.map((item, index) => (
              <Cell
                key={item.categoryId ?? 'uncategorized'}
                fill={item.color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [formatMoney(Number(value)), String(name)]}
            contentStyle={{
              background: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: '0.5rem',
              color: 'var(--popover-foreground)',
              fontSize: '0.8rem',
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
