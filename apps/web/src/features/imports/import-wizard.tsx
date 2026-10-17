import { useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  RotateCcw,
  Upload,
} from 'lucide-react';

import {
  type CategoryDTO,
  type CategoryKind,
  type ImportCommitResultDTO,
  type ImportPreviewDTO,
  type ImportPreviewRowDTO,
  type ImportTargetField,
} from '@spendscope/shared';

import { Amount } from '@/components/common/amount';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/controls';
import { Select } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { Label } from '@/components/ui/primitives';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCategories } from '@/features/categories/queries';
import { useCommitImport, usePreviewImport } from '@/features/imports/queries';
import { useMoney } from '@/hooks/use-money';
import { apiDownloadUrl, errorMessage } from '@/lib/api';
import { IMPORT_ROW_STATUS_LABELS, TRANSACTION_TYPE_LABELS, pluralise } from '@/lib/format';

type Stage = 'upload' | 'map' | 'review' | 'done';

type MappingDraft = Partial<Record<ImportTargetField, string>>;

interface TargetSpec {
  field: ImportTargetField;
  label: string;
  required: boolean;
  help: string;
}

const TARGETS: TargetSpec[] = [
  { field: 'date', label: 'Date', required: true, help: 'The transaction date.' },
  { field: 'description', label: 'Description', required: true, help: 'The transaction narrative.' },
  {
    field: 'amount',
    label: 'Amount',
    required: true,
    help: 'The main amount column. For a debit/credit export this is normally the debit (withdrawal) column.',
  },
  {
    field: 'credit',
    label: 'Credit (optional)',
    required: false,
    help: 'Deposit column, if the export splits debits and credits. Rows with a value here are read as income.',
  },
  {
    field: 'type',
    label: 'Type (optional)',
    required: false,
    help: 'An explicit type column (INCOME, EXPENSE, TRANSFER, REFUND). Overrides sign and debit/credit inference.',
  },
  { field: 'category', label: 'Category (optional)', required: false, help: 'Category names matched case-insensitively.' },
  { field: 'merchant', label: 'Merchant (optional)', required: false, help: 'Used for duplicate detection.' },
  { field: 'notes', label: 'Notes (optional)', required: false, help: 'Free-text notes.' },
];

function kindForType(type: ImportPreviewRowDTO['type']): CategoryKind | null {
  if (type === 'INCOME') return 'INCOME';
  if (type === 'EXPENSE' || type === 'REFUND') return 'EXPENSE';
  return null;
}

const ROW_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  valid: 'success',
  duplicate_possible: 'warning',
  duplicate_exact: 'neutral',
  invalid: 'danger',
};

export function ImportWizard({ onFinished }: { onFinished?: () => void }) {
  const previewMutation = usePreviewImport();
  const commitMutation = useCommitImport();
  const categoriesQuery = useCategories();
  const { formatMoney, formatDate } = useMoney();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>('upload');
  const [fileWarning, setFileWarning] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewDTO | null>(null);
  const [mapping, setMapping] = useState<MappingDraft>({});
  const [overrides, setOverrides] = useState<Record<number, string | null>>({});
  const [mode, setMode] = useState<'skip_invalid' | 'block_on_invalid'>('skip_invalid');
  const [importDuplicates, setImportDuplicates] = useState(false);
  const [markReviewed, setMarkReviewed] = useState(false);
  const [result, setResult] = useState<ImportCommitResultDTO | null>(null);

  const categories = categoriesQuery.data ?? [];
  const mappingComplete = Boolean(mapping.date && mapping.description && mapping.amount);

  const summary = preview?.summary ?? null;
  const hasRowsToReview = (summary?.valid ?? 0) + (summary?.duplicatesPossible ?? 0) > 0;

  const resetAll = () => {
    setStage('upload');
    setFileWarning(null);
    setPreview(null);
    setMapping({});
    setOverrides({});
    setMode('skip_invalid');
    setImportDuplicates(false);
    setMarkReviewed(false);
    setResult(null);
    previewMutation.reset();
    commitMutation.reset();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const applyPreview = (dto: ImportPreviewDTO) => {
    setPreview(dto);
    setMapping((current) => {
      const detected: MappingDraft = {};
      const suggested = dto.detection.suggestedMapping ?? {};
      for (const [field, header] of Object.entries(suggested)) {
        if (typeof header === 'string' && header.length > 0) detected[field as ImportTargetField] = header;
      }
      const applied: MappingDraft = {};
      const mapped = dto.mapping ?? {};
      for (const [field, header] of Object.entries(mapped)) {
        if (typeof header === 'string' && header.length > 0) applied[field as ImportTargetField] = header;
      }
      return { ...detected, ...applied, ...current };
    });
    setOverrides({});
    if (dto.status === 'ready') setStage('review');
    else if (dto.status === 'mapping_required') setStage('map');
    else {
      setStage('upload');
      setFileWarning(
        'That file has a header row but no data rows. Check the export and try again, or download the template.',
      );
    }
  };

  const handleFile = async (file: File) => {
    setFileWarning(null);
    const text = await file.text();
    try {
      const dto = await previewMutation.mutateAsync({ filename: file.name, content: text });
      applyPreview(dto);
      if (dto.status === 'ready') toast.success('File analysed — review the rows before importing');
    } catch (error) {
      toast.error(errorMessage(error));
      setStage('upload');
    }
  };

  const runValidation = async () => {
    if (!preview) return;
    try {
      const dto = await previewMutation.mutateAsync({ previewId: preview.previewId, mapping });
      applyPreview(dto);
      if (dto.status === 'ready') toast.success('Rows validated');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const commit = async () => {
    if (!preview) return;
    try {
      const commitInput = {
        previewId: preview.previewId,
        mode,
        importDuplicates,
        markReviewed,
        categoryOverrides: Object.entries(overrides).map(([rowIndex, categoryId]) => ({
          rowIndex: Number(rowIndex),
          categoryId,
        })),
      };
      const committed = await commitMutation.mutateAsync(commitInput);
      setResult(committed);
      setStage('done');
      toast.success(`Imported ${pluralise(committed.created, 'transaction')}`);
      onFinished?.();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="size-4" />
          Import a CSV
        </CardTitle>
        <CardDescription>
          Import a bank or spreadsheet export. Nothing leaves your machine — files are parsed by the local API and
          stored in your local database.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ol className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {(
            [
              ['upload', '1. Upload'],
              ['map', '2. Map columns'],
              ['review', '3. Review & import'],
              ['done', '4. Done'],
            ] as const
          ).map(([key, label]) => (
            <li
              key={key}
              aria-current={stage === key ? 'step' : undefined}
              className={stage === key ? 'font-medium text-primary' : 'text-muted-foreground'}
            >
              {label}
            </li>
          ))}
        </ol>

        {stage === 'upload' ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-file">CSV file</Label>
              <input
                id="import-file"
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="block w-full cursor-pointer rounded-md border border-input bg-card px-3 py-2 text-sm file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
              <p className="text-xs text-muted-foreground">
                A header row is required. Maximum file size 5 MB, up to 20,000 data rows. Date, description and amount
                are the only columns that must be mapped.
              </p>
            </div>

            {previewMutation.isPending ? <Alert variant="info">Reading and validating the file…</Alert> : null}

            {fileWarning ? (
              <Alert variant="warning" title="Nothing to import">
                {fileWarning}
              </Alert>
            ) : null}

            {previewMutation.error ? (
              <Alert variant="destructive" title="Could not read the file">
                {errorMessage(previewMutation.error)}
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={apiDownloadUrl('/imports/template')} download>
                  <Download className="size-4" />
                  Download CSV template
                </a>
              </Button>
            </div>
          </div>
        ) : null}

        {stage === 'map' && preview ? (
          <div className="flex flex-col gap-4">
            <Alert variant="info" title={`${preview.filename} · ${pluralise(preview.detection.rowCount, 'data row')}`}>
              Detected a {preview.detection.delimiter === '\t' ? 'tab' : `"${preview.detection.delimiter}"`} delimiter.
              {preview.detection.hasBom ? ' A byte-order mark was removed.' : ''} Confirm which column is which.
            </Alert>

            <div className="grid gap-4 sm:grid-cols-2">
              {TARGETS.map((target) => (
                <div key={target.field} className="flex flex-col gap-1.5">
                  <Label htmlFor={`map-${target.field}`}>
                    {target.label}
                    {target.required ? <span className="text-destructive"> *</span> : null}
                  </Label>
                  <Select
                    id={`map-${target.field}`}
                    value={mapping[target.field] ?? ''}
                    onChange={(event) =>
                      setMapping((current) => {
                        const next: MappingDraft = { ...current };
                        const value = event.target.value;
                        if (value === '') delete next[target.field];
                        else next[target.field] = value;
                        return next;
                      })
                    }
                  >
                    <option value="">{target.required ? 'Select a column…' : 'Not mapped'}</option>
                    {preview.detection.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </Select>
                  <p className="text-xs text-muted-foreground">{target.help}</p>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <caption className="p-3 text-left text-xs text-muted-foreground">
                  First rows from the file, exactly as they were read.
                </caption>
                <thead className="bg-muted/50">
                  <tr>
                    {preview.detection.headers.map((header) => (
                      <th key={header} scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.detection.sampleRows.map((row, index) => (
                    <tr key={index} className="border-t border-border">
                      {preview.detection.headers.map((header) => (
                        <td key={header} className="max-w-[14rem] truncate px-3 py-2 text-muted-foreground">
                          {row[header] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void runValidation()} disabled={!mappingComplete || previewMutation.isPending}>
                {previewMutation.isPending ? 'Validating…' : 'Validate rows'}
              </Button>
              <Button variant="ghost" onClick={resetAll}>
                <RotateCcw className="size-4" />
                Start over
              </Button>
              {!mappingComplete ? (
                <span className="text-xs text-muted-foreground">Map date, description and amount to continue.</span>
              ) : null}
            </div>
          </div>
        ) : null}

        {stage === 'review' && preview && summary ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <SummaryTile label="Total rows" value={summary.total} />
              <SummaryTile label="Valid" value={summary.valid} tone="success" />
              <SummaryTile label="Possible duplicates" value={summary.duplicatesPossible} tone="warning" />
              <SummaryTile label="Exact duplicates" value={summary.duplicatesExact} tone="neutral" />
              <SummaryTile label="Invalid" value={summary.invalid} tone="danger" />
            </div>

            {preview.warnings.map((warning) => (
              <Alert key={warning} variant="warning">
                {warning}
              </Alert>
            ))}

            {summary.invalid > 0 ? (
              <Alert variant="destructive" title={`${pluralise(summary.invalid, 'row')} could not be validated`}>
                These rows have errors and are listed below. Fix the file and re-upload, or skip them. You can download
                the errors as a CSV.
              </Alert>
            ) : null}

            {summary.duplicatesPossible > 0 ? (
              <Alert variant="warning" title={`${pluralise(summary.duplicatesPossible, 'possible duplicate')}`}>
                These rows share a date and amount with an existing transaction but differ in wording. They are imported
                and flagged for review unless you skip them.
              </Alert>
            ) : null}

            {!hasRowsToReview ? (
              <Alert variant="info" title="No importable rows">
                Every row is either a duplicate or invalid. Adjust the mapping or the file and try again.
              </Alert>
            ) : null}

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <caption className="p-3 text-left text-xs text-muted-foreground">
                  {preview.rowsTruncated
                    ? `Showing the first ${preview.rows.length} of ${summary.total} rows. All rows are validated and imported, not just these.`
                    : `All ${preview.rows.length} rows.`}
                </caption>
                <thead className="bg-muted/50">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium">Row</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium">Date</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium">Description</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium">Type</th>
                    <th scope="col" className="px-3 py-2 text-right text-xs font-medium">Amount</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium">Status</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium">Category</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <PreviewRow
                      key={row.rowIndex}
                      row={row}
                      categories={categories}
                      selectedCategory={
                        Object.prototype.hasOwnProperty.call(overrides, row.rowIndex)
                          ? overrides[row.rowIndex] ?? ''
                          : row.suggestedCategoryId ?? ''
                      }
                      onSelect={(value) =>
                        setOverrides((current) => {
                          const next = { ...current };
                          if (value === (row.suggestedCategoryId ?? '')) delete next[row.rowIndex];
                          else next[row.rowIndex] = value === '' ? null : value;
                          return next;
                        })
                      }
                      formatMoney={formatMoney}
                      formatDate={formatDate}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div className="flex flex-col gap-1.5 sm:max-w-md">
                <Label htmlFor="import-mode">If some rows are invalid</Label>
                <Select
                  id="import-mode"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as typeof mode)}
                >
                  <option value="skip_invalid">Import the valid rows and skip invalid ones (recommended)</option>
                  <option value="block_on_invalid">Import nothing unless every row is valid</option>
                </Select>
              </div>

              <SwitchOption
                id="import-duplicates"
                checked={importDuplicates}
                onChange={setImportDuplicates}
                label="Import exact duplicates"
                description={`${summary.duplicatesExact} row(s) exactly match a transaction already stored. Off by default so you do not import the same file twice.`}
              />

              <SwitchOption
                id="import-reviewed"
                checked={markReviewed}
                onChange={setMarkReviewed}
                label="Mark imported rows as reviewed"
                description="Off by default: imported rows start as 'needs review' so you can check them."
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void commit()} disabled={commitMutation.isPending || !hasRowsToReview}>
                <Upload className="size-4" />
                {commitMutation.isPending ? 'Importing…' : 'Import rows'}
              </Button>
              <Button variant="outline" onClick={() => setStage('map')} disabled={commitMutation.isPending}>
                <ArrowLeft className="size-4" />
                Back to mapping
              </Button>
              <Button asChild variant="ghost" size="sm">
                <a href={apiDownloadUrl(`/imports/previews/${preview.previewId}/report`)} download>
                  <Download className="size-4" />
                  Download error report
                </a>
              </Button>
              <Button variant="ghost" onClick={resetAll} disabled={commitMutation.isPending}>
                <RotateCcw className="size-4" />
                Start over
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              The preview is held briefly on the server and can only be imported once. It expires at{' '}
              {new Date(preview.expiresAt).toLocaleTimeString()}.
            </p>
          </div>
        ) : null}

        {stage === 'done' && result ? (
          <div className="flex flex-col gap-4">
            <Alert variant="success" title="Import complete">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="size-4" />
                {pluralise(result.created, 'transaction')} imported from {result.batch.filename}.
              </span>
            </Alert>

            <div className="grid gap-3 sm:grid-cols-4">
              <SummaryTile label="Created" value={result.created} tone="success" />
              <SummaryTile label="Skipped duplicates" value={result.skippedDuplicates} tone="neutral" />
              <SummaryTile label="Rejected (invalid)" value={result.rejected} tone="danger" />
              <SummaryTile label="Total rows" value={result.total} />
            </div>

            {result.errors.length > 0 ? (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
                <TableContainer>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Problems</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.errors.map((entry) => (
                        <TableRow key={entry.rowIndex}>
                          <TableCell className="tabular">{entry.rowIndex + 1}</TableCell>
                          <TableCell className="text-muted-foreground">{entry.messages.join('; ')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button onClick={resetAll}>
                <Upload className="size-4" />
                Import another file
              </Button>
              <Button asChild variant="outline">
                <a href="/transactions">Review imported transactions</a>
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SummaryTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'neutral';
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning-foreground'
        : tone === 'danger'
          ? 'text-destructive'
          : tone === 'neutral'
            ? 'text-muted-foreground'
            : 'text-foreground';
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`tabular mt-1 text-xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function SwitchOption({
  id,
  checked,
  onChange,
  label,
  description,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-labelledby={`${id}-label`} />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} id={`${id}-label`} className="cursor-pointer">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function PreviewRow({
  row,
  categories,
  selectedCategory,
  onSelect,
  formatMoney,
  formatDate,
}: {
  row: ImportPreviewRowDTO;
  categories: CategoryDTO[];
  selectedCategory: string;
  onSelect: (value: string) => void;
  formatMoney: (value: string) => string;
  formatDate: (value: string | null) => string;
}) {
  const kind = kindForType(row.type);
  const options = kind ? categories.filter((category) => category.kind === kind) : [];
  const invalid = row.status === 'invalid';

  return (
    <tr className={invalid ? 'border-t border-border bg-destructive/5' : 'border-t border-border'}>
      <td className="tabular px-3 py-2 text-muted-foreground">{row.rowIndex + 1}</td>
      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDate(row.transactionDate)}</td>
      <td className="max-w-[18rem] px-3 py-2">
        <span className="block truncate">{row.description || '—'}</span>
        {row.errors.length > 0 ? (
          <span className="block text-xs text-destructive">{row.errors.join('; ')}</span>
        ) : row.merchant ? (
          <span className="block truncate text-xs text-muted-foreground">{row.merchant}</span>
        ) : null}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
        {row.type ? TRANSACTION_TYPE_LABELS[row.type] : '—'}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        {row.type && row.amount ? (
          <Amount type={row.type} formatted={formatMoney(row.amount)} />
        ) : (
          <span className="text-muted-foreground">{row.amount ?? '—'}</span>
        )}
      </td>
      <td className="px-3 py-2">
        <Badge variant={ROW_STATUS_VARIANT[row.status] ?? 'neutral'}>{IMPORT_ROW_STATUS_LABELS[row.status]}</Badge>
        {row.duplicateOfId ? (
          <span className="mt-1 block text-xs text-muted-foreground">matches an existing transaction</span>
        ) : null}
      </td>
      <td className="px-3 py-2">
        {invalid || !kind ? (
          <span className="text-xs text-muted-foreground">
            {kind ? 'Not applicable' : 'Transfers are not categorised'}
          </span>
        ) : (
          <Select
            aria-label={`Category for row ${row.rowIndex + 1}`}
            value={selectedCategory}
            onChange={(event) => onSelect(event.target.value)}
            className="min-w-40"
          >
            <option value="">
              {row.suggestedCategoryName ? `Uncategorized (suggested: ${row.suggestedCategoryName})` : 'Uncategorized'}
            </option>
            {options.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.id === row.suggestedCategoryId ? ' (suggested)' : ''}
              </option>
            ))}
          </Select>
        )}
      </td>
    </tr>
  );
}
