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

      <Alert variant="info" title="How your file is handled">
        The CSV is uploaded to SpendScope, checked row by row, and stored in your private workspace. No third-party
        service is contacted.
      </Alert>

      <ImportWizard />

      <ImportHistory />
    </div>
  );
}
