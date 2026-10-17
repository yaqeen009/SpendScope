import type { ReactNode } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export interface ChartFrameProps {
  title: string;
  description?: string;
  /** Rendered when there is no data to plot. */
  empty?: ReactNode;
  hasData: boolean;
  /** Screen-reader-friendly tabular equivalent of the chart. */
  table: { caption: string; headers: string[]; rows: (string | number)[][] };
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Card wrapper every chart shares. It guarantees a title, an optional
 * description, a rendered empty state, and an accessible tabular equivalent so
 * the information is never conveyed by colour or shape alone.
 */
export function ChartFrame({
  title,
  description,
  hasData,
  empty = <p className="py-10 text-center text-sm text-muted-foreground">No data for this period.</p>,
  table,
  children,
  footer,
  className,
}: ChartFrameProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {hasData ? (
          <div className="h-64 w-full">{children}</div>
        ) : (
          <div className="grid h-64 place-items-center">{empty}</div>
        )}

        {hasData ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
              View as a table
            </summary>
            <div className="mt-2 max-h-56 overflow-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <caption className="sr-only">{table.caption}</caption>
                <thead className="bg-muted/50">
                  <tr>
                    {table.headers.map((header) => (
                      <th key={header} scope="col" className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, index) => (
                    <tr key={index} className="border-t border-border">
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="px-2 py-1.5">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}

        {footer}
      </CardContent>
    </Card>
  );
}
