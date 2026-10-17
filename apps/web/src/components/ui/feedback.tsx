import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} aria-hidden="true" />;
}

/** Full-card placeholder used while a page's primary query is loading. */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-3 py-16">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ title = 'Could not load data', message, onRetry }: ErrorStateProps) {
  return (
    <Card className="flex flex-col items-start gap-3 border-destructive/40 p-6" role="alert">
      <div className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="size-4" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          Try again
        </Button>
      ) : null}
    </Card>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-14 text-center">
      {icon ? <div className="mb-1 text-muted-foreground">{icon}</div> : null}
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

type AlertVariant = 'info' | 'warning' | 'destructive' | 'success';

const ALERT_STYLES: Record<AlertVariant, { container: string; icon: ReactNode }> = {
  info: { container: 'border-border bg-muted/50 text-foreground', icon: <Info className="size-4" /> },
  warning: { container: 'border-warning/40 bg-warning/10 text-foreground', icon: <AlertTriangle className="size-4" /> },
  destructive: {
    container: 'border-destructive/40 bg-destructive/10 text-foreground',
    icon: <AlertTriangle className="size-4" />,
  },
  success: { container: 'border-success/40 bg-success/10 text-foreground', icon: <CheckCircle2 className="size-4" /> },
};

export function Alert({
  variant = 'info',
  title,
  children,
  className,
}: {
  variant?: AlertVariant;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const styles = ALERT_STYLES[variant];
  return (
    <div
      className={cn('flex gap-3 rounded-lg border p-3 text-sm', styles.container, className)}
      role={variant === 'destructive' ? 'alert' : 'status'}
    >
      <span
        className={cn(
          'mt-0.5 shrink-0',
          variant === 'destructive' && 'text-destructive',
          variant === 'warning' && 'text-warning-foreground',
          variant === 'success' && 'text-success',
          variant === 'info' && 'text-muted-foreground',
        )}
        aria-hidden="true"
      >
        {styles.icon}
      </span>
      <div className="flex flex-col gap-1">
        {title ? <p className="font-medium">{title}</p> : null}
        <div className="text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline">
          {children}
        </div>
      </div>
    </div>
  );
}
