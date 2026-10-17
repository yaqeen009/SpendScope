import { useState } from 'react';
import { History } from 'lucide-react';

import { Pagination } from '@/components/common/pagination';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/feedback';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useImportHistory } from '@/features/imports/queries';
import { errorMessage } from '@/lib/api';
import { IMPORT_STATUS_LABELS } from '@/lib/format';
import { useMoney } from '@/hooks/use-money';

const PAGE_SIZE = 10;

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger'> = {
  COMPLETED: 'success',
  PARTIAL: 'warning',
  FAILED: 'danger',
};

export function ImportHistory() {
  const [page, setPage] = useState(1);
  const query = useImportHistory(page, PAGE_SIZE);
  const { formatDate } = useMoney();

  const result = query.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import history</CardTitle>
        <CardDescription>Every CSV import you have run, most recent first.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {query.isPending ? <LoadingState label="Loading import history…" /> : null}

        {query.isError ? (
          <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : null}

        {result && result.data.length === 0 ? (
          <EmptyState
            icon={<History className="size-8" />}
            title="No imports yet"
            description="Imports you run will be listed here with the number of rows created, skipped and rejected."
          />
        ) : null}

        {result && result.data.length > 0 ? (
          <>
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Imported</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                    <TableHead className="text-right">Duplicates</TableHead>
                    <TableHead className="text-right">Invalid</TableHead>
                    <TableHead className="text-right">Total rows</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.data.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell className="max-w-[16rem]">
                        <span className="block truncate font-medium">{batch.filename}</span>
                        {batch.notes ? (
                          <span className="block truncate text-xs text-muted-foreground">{batch.notes}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(batch.createdAt.slice(0, 10))}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[batch.status] ?? 'neutral'}>
                          {IMPORT_STATUS_LABELS[batch.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular text-right font-medium">{batch.createdRows}</TableCell>
                      <TableCell className="tabular text-right">{batch.duplicateRows}</TableCell>
                      <TableCell className="tabular text-right">{batch.invalidRows}</TableCell>
                      <TableCell className="tabular text-right">{batch.totalRows}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              total={result.total}
              pageSize={result.pageSize}
              onPageChange={setPage}
              noun="imports"
            />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
