import type { ReactNode } from 'react';
import { Wallet } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Centred card used by the sign-in and sign-up screens. */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Wallet className="size-5" aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold tracking-tight">
            Spend<span className="text-primary">Scope</span>
          </span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">{children}</CardContent>
        </Card>

        {footer ? <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div> : null}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          All data is stored in your own database. Nothing is sent to a third party.
        </p>
      </div>
    </div>
  );
}
