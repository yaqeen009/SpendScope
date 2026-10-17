import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { TimeSeriesDTO } from '@spendscope/shared';

import { ChartFrame } from '@/components/charts/chart-frame';
import { useMoney } from '@/hooks/use-money';

const GRID = 'var(--border)';
const AXIS = 'var(--muted-foreground)';

export function IncomeExpenseChart({ series }: { series: TimeSeriesDTO }) {
  const { formatMoney, formatMoneyCompact } = useMoney();
  const points = series.points;
  const hasData = points.some((point) => Number(point.income) !== 0 || Number(point.expenses) !== 0);

  return (
    <ChartFrame
      title="Income vs expenses"
      description={`Grouped by ${series.granularity} across the selected period (transfers excluded).`}
      hasData={hasData}
      table={{
        caption: `Income and expenses grouped by ${series.granularity}`,
        headers: ['Period', 'Income', 'Expenses', 'Net'],
        rows: points.map((point) => [point.label, formatMoney(point.income), formatMoney(point.expenses), formatMoney(point.net)]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-5)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--chart-5)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis
            stroke={AXIS}
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
          <Area
            type="monotone"
            dataKey="income"
            name="Income"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#incomeFill)"
          />
          <Area
            type="monotone"
            dataKey="expenses"
            name="Expenses"
            stroke="var(--chart-5)"
            strokeWidth={2}
            fill="url(#expenseFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
