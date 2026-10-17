import { useState } from 'react';
import { CalendarRange } from 'lucide-react';

import type { PeriodKey, ReportingPeriod } from '@spendscope/shared';

import { Input, Select } from '@/components/ui/field';
import { Label } from '@/components/ui/primitives';
import { PERIOD_OPTIONS } from '@/hooks/use-period';

export interface PeriodSelectorProps {
  period: ReportingPeriod;
  onSelect: (key: PeriodKey, range?: { from: string; to: string }) => void;
}

/**
 * Reporting-period control. The resolved inclusive range is always shown so the
 * user can see exactly which dates a metric covers.
 */
export function PeriodSelector({ period, onSelect }: PeriodSelectorProps) {
  const [customFrom, setCustomFrom] = useState(period.key === 'custom' ? period.start : period.start);
  const [customTo, setCustomTo] = useState(period.key === 'custom' ? period.end : period.end);

  const handleKeyChange = (key: PeriodKey) => {
    if (key === 'custom') {
      onSelect('custom', { from: customFrom, to: customTo });
      return;
    }
    onSelect(key);
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="period-select">Reporting period</Label>
        <Select
          id="period-select"
          value={period.key}
          onChange={(event) => handleKeyChange(event.target.value as PeriodKey)}
          className="w-44"
        >
          {PERIOD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {period.key === 'custom' ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="period-from">From</Label>
            <Input
              id="period-from"
              type="date"
              value={customFrom}
              max={customTo}
              onChange={(event) => {
                setCustomFrom(event.target.value);
                if (event.target.value) onSelect('custom', { from: event.target.value, to: customTo });
              }}
              className="w-40"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="period-to">To</Label>
            <Input
              id="period-to"
              type="date"
              value={customTo}
              min={customFrom}
              onChange={(event) => {
                setCustomTo(event.target.value);
                if (event.target.value) onSelect('custom', { from: customFrom, to: event.target.value });
              }}
              className="w-40"
            />
          </div>
        </>
      ) : null}

      <p className="flex items-center gap-1.5 pb-2 text-xs text-muted-foreground">
        <CalendarRange className="size-3.5" aria-hidden="true" />
        <span>
          {period.start} → {period.end} (inclusive)
        </span>
      </p>
    </div>
  );
}
