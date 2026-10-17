import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { MonthlyTrendPoint } from '@spendscope/shared';

import { ChartFrame } from '@/components/charts/chart-frame';
import { useMoney } from '@/hooks/use-money';

export function MonthlyTrendChart({
  months,
  formatMonth,
}: {
  months: MonthlyTrendPoint[];
  formatMonth: (month: string) => string;
}) {
  const { formatMoney, formatMoneyCompact } = useMoney();
  const data = months.map((month) => ({ ...month, label: formatMonth(month.month) }));
  const hasData = months.some((month) => Number(month.income) !== 0 || Number(month.expenses) !== 0);

  return (
    <ChartFrame
      title="Monthly spending trend"
      description="Income and expenses per calendar month, including months with no activity."
      hasData={hasData}
      table={{
        caption: 'Income and expenses by month',
        headers: ['Month', 'Income', 'Expenses', 'Net'],
        rows: data.map((month) => [
          month.label,
          formatMoney(month.income),
          formatMoney(month.expenses),
          formatMoney(month.net),
        ]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            width={72}
            tickFormatter={(value: number) => formatMoneyCompact(value)}
          />
          <Tooltip
            formatter={(value) => formatMoney(Number(value))}
            contentStyle={{
              background: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: '0.5rem',
              color: 'var(--popover-foreground)',
              fontSize: '0.8rem',
            }}
          />
          <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
          <Bar dataKey="income" name="Income" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="expenses" name="Expenses" fill="var(--chart-5)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
