import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Database, Save, Sparkles, Trash2 } from 'lucide-react';

import {
  SUPPORTED_CURRENCIES,
  THEME_PREFERENCES,
  type PeriodKey,
  type SettingsDTO,
  type ThemePreference,
} from '@spendscope/shared';

import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, Input } from '@/components/ui/field';
import { Alert, ErrorState, LoadingState } from '@/components/ui/feedback';
import { Label, Separator } from '@/components/ui/primitives';
import {
  useManageDemoData,
  useResetData,
  useSettings,
  useUpdateSettings,
} from '@/features/settings/queries';
import { PERIOD_OPTIONS } from '@/hooks/use-period';
import { useTheme } from '@/hooks/use-theme';
import { errorMessage } from '@/lib/api';
import { pluralise } from '@/lib/format';

const THEME_LABELS: Record<ThemePreference, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Follow system',
};

export function SettingsPage() {
  const settingsQuery = useSettings();
  const updateSettings = useUpdateSettings();
  const demoMutation = useManageDemoData();
  const resetMutation = useResetData();
  const { theme, setTheme } = useTheme();

  const [demoConfirm, setDemoConfirm] = useState<'restore' | 'clear' | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [includeImported, setIncludeImported] = useState(false);
  const [resetCategories, setResetCategories] = useState(false);

  const settings = settingsQuery.data;

  const changeTheme = (next: ThemePreference) => {
    setTheme(next);
    updateSettings.mutate({ theme: next });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Display preferences, sample data and data management. Everything is stored locally."
      />

      {settingsQuery.isPending ? <LoadingState label="Loading settings…" /> : null}

      {settingsQuery.isError ? (
        <ErrorState message={errorMessage(settingsQuery.error)} onRetry={() => void settingsQuery.refetch()} />
      ) : null}

      {settings ? (
        <>
          <PreferencesCard key={settings.updatedAt} settings={settings} />

          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>
                Stored in this browser and mirrored to your workspace so it survives a fresh browser.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-1.5 sm:max-w-xs">
                <Label htmlFor="settings-theme">Theme</Label>
                <Select
                  id="settings-theme"
                  value={theme}
                  onChange={(event) => changeTheme(event.target.value as ThemePreference)}
                >
                  {THEME_PREFERENCES.map((preference) => (
                    <option key={preference} value={preference}>
                      {THEME_LABELS[preference]}
                    </option>
                  ))}
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sample data</CardTitle>
              <CardDescription>
                A fictional dataset, generated locally, so you can explore the app before importing your own bank
                exports. Sample rows are always labelled and never affect your real data unless you import over them.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setDemoConfirm('restore')}>
                <Sparkles className="size-4" />
                Load / reset sample data
              </Button>
              <Button variant="outline" onClick={() => setDemoConfirm('clear')}>
                <Trash2 className="size-4" />
                Remove sample data
              </Button>
            </CardContent>
          </Card>

          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="size-4" />
                Danger zone
              </CardTitle>
              <CardDescription>
                Reset your workspace. This cannot be undone. Budgets and import history are always removed; transactions
                are removed only when you ask for it below.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="destructive" onClick={() => setResetOpen(true)}>
                <Database className="size-4" />
                Reset workspace data
              </Button>
            </CardContent>
          </Card>

          <Separator />

          <p className="text-xs text-muted-foreground">
            Workspace ID <code className="rounded bg-muted px-1 py-0.5">{settings.workspaceId}</code> · last updated{' '}
            {new Date(settings.updatedAt).toLocaleString()}
          </p>
        </>
      ) : null}

      <ConfirmDialog
        open={demoConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setDemoConfirm(null);
        }}
        title={demoConfirm === 'clear' ? 'Remove all sample data?' : 'Load the sample dataset?'}
        confirmLabel={demoConfirm === 'clear' ? 'Remove sample data' : 'Load sample data'}
        destructive={demoConfirm === 'clear'}
        description={
          demoConfirm === 'clear'
            ? 'Every transaction marked as sample data will be deleted, along with all budgets. Imported transactions are not touched.'
            : 'This clears any existing sample rows and generates a fresh fictional dataset of roughly six months of transactions and budgets.'
        }
        onConfirm={async () => {
          if (!demoConfirm) return;
          const result = await demoMutation.mutateAsync(demoConfirm);
          toast.success(
            demoConfirm === 'clear'
              ? `Sample data removed · ${pluralise(result.transactions, 'transaction')}`
              : `Sample data loaded · ${pluralise(result.transactions, 'transaction')} and ${pluralise(result.budgets, 'budget')}`,
          );
          setDemoConfirm(null);
        }}
      />

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={(open) => {
          if (!open) {
            setResetOpen(false);
            setResetToken('');
            setIncludeImported(false);
            setResetCategories(false);
          }
        }}
        title="Reset workspace data?"
        confirmLabel="Reset data"
        destructive
        description="This permanently deletes data for this workspace. Type RESET to confirm."
        onConfirm={async () => {
          const result = await resetMutation.mutateAsync({
            confirm: resetToken,
            includeImported,
            resetCategories,
          });
          toast.success(
            `Workspace reset · ${pluralise(result.transactions, 'transaction')}, ${pluralise(result.budgets, 'budget')}, ${pluralise(result.importBatches, 'import batch', 'import batches')} removed`,
          );
          setResetOpen(false);
          setResetToken('');
          setIncludeImported(false);
          setResetCategories(false);
        }}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reset-token">Type RESET to confirm</Label>
            <Input
              id="reset-token"
              value={resetToken}
              onChange={(event) => setResetToken(event.target.value)}
              placeholder="RESET"
              autoComplete="off"
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={includeImported}
              onChange={(event) => setIncludeImported(event.target.checked)}
            />
            <span>
              Also delete imported and manually entered transactions
              <span className="block text-xs text-muted-foreground">
                Leave this off to delete only sample data, budgets and import history.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={resetCategories}
              onChange={(event) => setResetCategories(event.target.checked)}
            />
            <span>
              Reset categories to the defaults
              <span className="block text-xs text-muted-foreground">
                Deletes custom categories and recreates the built-in catalogue.
              </span>
            </span>
          </label>
        </div>
      </ConfirmDialog>
    </div>
  );
}

/**
 * Editable copy of the display preferences. Keyed by the settings row's
 * `updatedAt` so a saved change remounts it with fresh values instead of
 * needing an effect to copy server state into local state.
 */
function PreferencesCard({ settings }: { settings: SettingsDTO }) {
  const updateSettings = useUpdateSettings();

  const [currency, setCurrency] = useState(settings.currency);
  const [locale, setLocale] = useState(settings.locale);
  const [defaultPeriod, setDefaultPeriod] = useState<PeriodKey>(settings.defaultPeriod);

  const dirty =
    currency !== settings.currency || locale !== settings.locale || defaultPeriod !== settings.defaultPeriod;

  const savePreferences = async () => {
    try {
      await updateSettings.mutateAsync({
        currency: currency as (typeof SUPPORTED_CURRENCIES)[number],
        locale,
        defaultPeriod,
      });
      toast.success('Preferences saved');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferences</CardTitle>
        <CardDescription>How amounts and dates are displayed, and the default reporting period.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-currency">Currency</Label>
            <Select id="settings-currency" value={currency} onChange={(event) => setCurrency(event.target.value)}>
              {SUPPORTED_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-locale">Locale</Label>
            <Input
              id="settings-locale"
              value={locale}
              onChange={(event) => setLocale(event.target.value)}
              placeholder="en-GH"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-period">Default period</Label>
            <Select
              id="settings-period"
              value={defaultPeriod}
              onChange={(event) => setDefaultPeriod(event.target.value as PeriodKey)}
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <Alert variant="warning" title="Changing the currency does not convert your data">
          The currency setting only changes how amounts are formatted. It never converts or restates a stored amount —
          a transaction entered as 100.00 stays 100.00 and is simply shown with the chosen symbol.
        </Alert>

        <div className="flex items-center gap-3">
          <Button onClick={() => void savePreferences()} disabled={!dirty || updateSettings.isPending}>
            <Save className="size-4" />
            {updateSettings.isPending ? 'Saving…' : 'Save preferences'}
          </Button>
          {!dirty ? <span className="text-xs text-muted-foreground">No unsaved changes.</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}
