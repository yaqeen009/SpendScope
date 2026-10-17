import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { TransactionDTO } from '@spendscope/shared';

import { Amount } from '@/components/common/amount';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/primitives';
import { REVIEW_STATUS_LABELS, TRANSACTION_TYPE_LABELS } from '@/lib/format';
import { useMoney } from '@/hooks/use-money';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/** Read-only view of every stored field, including provenance and timestamps. */
export function TransactionDetailDialog({
  open,
  onOpenChange,
  transaction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionDTO | null;
}) {
  const { formatMoney, formatDate } = useMoney();
  if (!transaction) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transaction details</DialogTitle>
          <DialogDescription>
            Stored values as saved in the database. Amounts are positive magnitudes with an explicit type.
          </DialogDescription>
        </DialogHeader>

        <dl className="divide-y divide-border">
          <Row label="Description">{transaction.description}</Row>
          <Row label="Transaction date">{formatDate(transaction.transactionDate)}</Row>
          <Row label="Merchant / counterparty">{transaction.merchant ?? '—'}</Row>
          <Row label="Amount">
            <Amount type={transaction.type} formatted={formatMoney(transaction.amount)} />
            <span className="ml-2 text-xs text-muted-foreground">
              stored as {transaction.amount} ({TRANSACTION_TYPE_LABELS[transaction.type]})
            </span>
          </Row>
          <Row label="Category">
            {transaction.category ? (
              <span className="inline-flex items-center gap-2">
                <span
                  className="size-2.5 rounded-full border border-border"
                  style={{ background: transaction.category.color ?? 'var(--muted-foreground)' }}
                  aria-hidden="true"
                />
                {transaction.category.name}
              </span>
            ) : (
              'Uncategorized'
            )}
          </Row>
          <Row label="Notes">{transaction.notes ?? '—'}</Row>
          <Row label="Review status">
            <Badge variant={transaction.reviewStatus === 'REVIEWED' ? 'success' : 'warning'}>
              {REVIEW_STATUS_LABELS[transaction.reviewStatus]}
            </Badge>
          </Row>
          <Row label="Source">
            {transaction.isSample ? (
              <Badge variant="neutral">Sample data</Badge>
            ) : transaction.importBatchId ? (
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">CSV import</Badge>
                <Link to="/import" className="text-xs text-primary underline">
                  View import history
                </Link>
              </span>
            ) : (
              <span>Added manually</span>
            )}
          </Row>
          {transaction.fingerprint ? <Row label="Duplicate fingerprint">{transaction.fingerprint}</Row> : null}
          <Row label="Created">{new Date(transaction.createdAt).toLocaleString()}</Row>
          <Row label="Last updated">{new Date(transaction.updatedAt).toLocaleString()}</Row>
        </dl>

        <Separator />
        <p className="text-xs text-muted-foreground">
          Transaction ID <code className="font-mono">{transaction.id}</code>
        </p>
      </DialogContent>
    </Dialog>
  );
}
