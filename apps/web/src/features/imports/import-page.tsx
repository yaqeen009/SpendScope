import { PageHeader } from '@/components/layout/page-header';
import { Alert } from '@/components/ui/feedback';
import { ImportHistory } from '@/features/imports/import-history';
import { ImportWizard } from '@/features/imports/import-wizard';

export function ImportPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Import CSV"
        description="Bring in a bank or spreadsheet export, check every row before it is stored, then review the imported transactions."
      />

      <Alert variant="info" title="Your file stays on this machine">
        The CSV is uploaded to the SpendScope API running locally, parsed there, and stored in your local PostgreSQL
        database. No third-party service is contacted and no data leaves your computer.
      </Alert>

      <ImportWizard />

      <ImportHistory />
    </div>
  );
}
