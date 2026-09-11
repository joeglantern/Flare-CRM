/**
 * Import and export (Import Export). A three step import wizard and a one click export.
 *
 * The header row is parsed in the browser, so column mapping happens before anything is uploaded
 * and a wrong file is caught in the moment rather than as a failed job. Nothing is written until
 * the last step, and the summary says exactly what will happen to duplicates.
 * GAP-09: only contacts, companies and leads can be imported. Deals, tasks and calls export only,
 * and this screen says so instead of offering an import that would 400.
 */
import { IMPORT_FIELDS, type ImportJobDto, type ImportMapping } from '@crm/shared';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileSpreadsheet,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Loading';
import { Drawer } from '@/components/ui/Overlay';
import { Select } from '@/components/ui/Select';
import { Segmented } from '@/components/ui/Toggle';
import { toast } from '@/components/ui/toast';
import { DateTime } from '@/components/data/formatters';
import { ImportStatusBadge } from '@/components/data/status';
import { EmptyState, ErrorState, ForbiddenState } from '@/components/data/states';
import { ProgressBar } from '@/components/data/charts';
import { Panel } from '@/components/entity/EntityHeader';
import { OwnerPicker } from '@/components/entity/pickers';
import { TagInput } from '@/components/entity/TagInput';
import { PageHeader } from '@/app/shell/TopBar';
import { usePageMeta } from '@/app/shell/page-meta';
import { errorMessage } from '@/lib/api/errors';
import { useSearchParam } from '@/lib/list-state';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/providers/permissions';
import { useSettings } from '@/providers/settings';
import {
  exportCsv,
  guessMapping,
  importErrorReportUrl,
  previewCsv,
  useImports,
  useStartImport,
  type ExportEntity,
  type ImportEntity,
} from './api';

const IMPORTABLE: { value: ImportEntity; label: string }[] = [
  { value: 'contact', label: 'Contacts' },
  { value: 'company', label: 'Companies' },
  { value: 'lead', label: 'Leads' },
];

const EXPORTABLE: { value: ExportEntity; label: string; importable: boolean }[] = [
  { value: 'contacts', label: 'Contacts', importable: true },
  { value: 'companies', label: 'Companies', importable: true },
  { value: 'leads', label: 'Leads', importable: true },
  { value: 'deals', label: 'Deals', importable: false },
  { value: 'tasks', label: 'Tasks', importable: false },
  { value: 'calls', label: 'Calls', importable: false },
];

export function ImportExportScreen() {
  usePageMeta([{ label: 'Imports' }]);
  const perms = usePermissions();
  const [createParam, setCreateParam] = useSearchParam('create');
  const [entityParam] = useSearchParam('entity');

  const canImport = perms.has('contact:import');
  const query = useImports({ pageSize: 20 }, canImport);
  const rows = query.data?.data ?? [];

  if (!canImport) {
    return <ForbiddenState permission="contact:import" what="Imports" />;
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Import and export"
        description="Bring a spreadsheet in, or take your data out as CSV."
        actions={
          <Button
            variant="primary"
            icon={Upload}
            onClick={() => {
              setCreateParam('true');
            }}
          >
            Import a CSV
          </Button>
        }
      />

      <ExportPanel />

      <Panel
        title="Import history"
        note="A running job refreshes every few seconds."
        padded={false}
      >
        {query.isPending ? (
          <div className="p-3">
            <Skeleton height={140} shape="block" />
          </div>
        ) : query.isError ? (
          <div className="p-3">
            <ErrorState
              message={errorMessage(query.error)}
              onRetry={() => {
                void query.refetch();
              }}
            />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            object="spreadsheet"
            title="Nothing imported yet"
            description="A CSV with a header row is all it takes."
            primaryAction={{
              label: 'Import a CSV',
              onClick: () => {
                setCreateParam('true');
              },
            }}
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((j) => (
              <ImportJobRow key={j.id} job={j} />
            ))}
          </ul>
        )}
      </Panel>

      <ImportWizard
        open={createParam !== undefined}
        onOpenChange={(v) => {
          setCreateParam(v ? 'true' : undefined);
        }}
        initialEntity={IMPORTABLE.find((e) => e.value === entityParam)?.value ?? 'contact'}
      />
    </div>
  );
}

function ImportJobRow({ job }: { job: ImportJobDto }) {
  const running = job.status === 'running' || job.status === 'queued';
  return (
    <li className="flex flex-col gap-2 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <FileSpreadsheet size={14} className="shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium capitalize">{job.entity}</span>
        <ImportStatusBadge status={job.status} />
        <span className="text-sm text-muted">
          <DateTime value={job.createdAt} mode="relative" />
        </span>
      </div>

      {running ? (
        <ProgressBar
          value={job.processedRows}
          max={Math.max(1, job.totalRows)}
          label={`${String(job.processedRows)} of ${String(job.totalRows)} rows`}
        />
      ) : (
        <p className="text-sm text-muted">
          {job.createdRows} created · {job.updatedRows} updated
          {job.errorRows > 0 && <span className="text-danger"> · {job.errorRows} failed</span>}
        </p>
      )}

      {job.errorRows > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <a href={importErrorReportUrl(job.id)} download>
            <Button variant="secondary" size="sm" icon={Download}>
              Download the failed rows
            </Button>
          </a>
          <span className="text-sm text-faint">
            Fix them in the CSV and import that file again.
          </span>
        </div>
      )}

      {job.errors.length > 0 && (
        <ul className="mono flex flex-col gap-0.5 rounded-sm border border-border bg-bg p-2 text-xs text-muted">
          {job.errors.slice(0, 5).map((e) => (
            <li key={e.row} className="truncate">
              Row {e.row}: {e.message}
            </li>
          ))}
          {job.errors.length > 5 && (
            <li className="text-faint">and {job.errors.length - 5} more</li>
          )}
        </ul>
      )}
    </li>
  );
}

/* ── export ─────────────────────────────────────────────────────────────────────────────── */

function ExportPanel() {
  const perms = usePermissions();
  const [busy, setBusy] = useState<ExportEntity | null>(null);

  const allowed: Record<ExportEntity, boolean> = {
    contacts: perms.has('contact:export'),
    companies: perms.has('company:export'),
    leads: perms.has('contact:export'),
    deals: perms.has('deal:export'),
    tasks: perms.has('task:read'),
    calls: perms.has('call:export'),
  };

  const run = (entity: ExportEntity) => {
    setBusy(entity);
    void exportCsv(entity, {})
      .then(() => {
        toast({ tone: 'success', title: 'Export downloaded' });
      })
      .catch((e: unknown) => {
        toast({ tone: 'danger', title: 'Export failed', description: errorMessage(e) });
      })
      .finally(() => {
        setBusy(null);
      });
  };

  return (
    <Panel title="Export" note="Exports everything you are allowed to see.">
      <div className="flex flex-wrap gap-2">
        {EXPORTABLE.filter((e) => allowed[e.value]).map((e) => (
          <Button
            key={e.value}
            variant="secondary"
            icon={Download}
            loading={busy === e.value}
            onClick={() => {
              run(e.value);
            }}
          >
            {e.label}
          </Button>
        ))}
      </div>
      <p className="mt-3 text-sm text-faint">
        To export a filtered set instead, use the Export button on that screen: it carries your
        current filters.
      </p>
    </Panel>
  );
}

/* ── import wizard ──────────────────────────────────────────────────────────────────────── */

type Step = 'file' | 'map' | 'confirm';

export function ImportWizard({
  open,
  onOpenChange,
  initialEntity,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialEntity: ImportEntity;
}) {
  const perms = usePermissions();
  const settings = useSettings();
  const start = useStartImport();

  const [step, setStep] = useState<Step>('file');
  const [entity, setEntity] = useState<ImportEntity>(initialEntity);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sample, setSample] = useState<string[][]>([]);
  const [columns, setColumns] = useState<Record<string, string>>({});
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'update'>('skip');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [country, setCountry] = useState(settings.defaultCountry);
  const [readError, setReadError] = useState<string | null>(null);

  const fields: Record<string, string> = IMPORT_FIELDS[entity];
  const mappedFields = Object.values(columns).filter((v) => v !== '');
  const requiredField = entity === 'company' ? 'name' : 'firstName';
  const hasRequired = mappedFields.includes(requiredField);
  const hasContactPoint =
    entity === 'company' || mappedFields.includes('phone') || mappedFields.includes('email');

  const reset = () => {
    setStep('file');
    setFile(null);
    setHeaders([]);
    setSample([]);
    setColumns({});
    setOnDuplicate('skip');
    setOwnerId(null);
    setTags([]);
    setCountry(settings.defaultCountry);
    setReadError(null);
  };

  const chooseFile = (f: File) => {
    setFile(f);
    setReadError(null);
    void previewCsv(f)
      .then((p) => {
        if (p.headers.length === 0) {
          setReadError('That file has no header row. The first line must name the columns.');
          return;
        }
        setHeaders(p.headers);
        setSample(p.rows);
        setColumns(guessMapping(p.headers, fields));
        setStep('map');
      })
      .catch(() => {
        setReadError('That file could not be read as CSV. Save it as CSV and try again.');
      });
  };

  const submit = () => {
    if (file === null) return;
    const mapping: ImportMapping = {
      columns: Object.fromEntries(Object.entries(columns).filter(([, v]) => v !== '')),
      onDuplicate,
      ...(ownerId !== null ? { ownerId } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(country !== '' ? { country } : {}),
    };
    start.mutate(
      { entity, file, mapping },
      {
        onSuccess: () => {
          toast({
            tone: 'success',
            title: 'Import started',
            description: 'It runs in the background. This page updates as it goes.',
          });
          onOpenChange(false);
          reset();
        },
        onError: (e) => {
          toast({
            tone: 'danger',
            title: 'Could not start the import',
            description: errorMessage(e),
          });
        },
      },
    );
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
      title="Import a CSV"

      width={640}
      dismissable={!start.isPending}
      footer={
        <>
          {step !== 'file' && (
            <Button
              variant="ghost"
              icon={ArrowLeft}
              onClick={() => {
                setStep(step === 'confirm' ? 'map' : 'file');
              }}
            >
              Back
            </Button>
          )}
          <span className="flex-1" />
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          {step === 'map' && (
            <Button
              variant="primary"
              icon={ArrowRight}
              disabled={!hasRequired || !hasContactPoint}
              onClick={() => {
                setStep('confirm');
              }}
            >
              Continue
            </Button>
          )}
          {step === 'confirm' && (
            <Button variant="primary" icon={Check} loading={start.isPending} onClick={submit}>
              Start the import
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <StepBar step={step} />

        {step === 'file' && (
          <>
            <Segmented
              value={entity}
              onChange={(v) => {
                setEntity(v);
                setColumns({});
              }}
              ariaLabel="What to import"
              options={IMPORTABLE.filter((e) => e.value !== 'lead' || perms.has('lead:import')).map(
                (e) => ({
                  value: e.value,
                  label: e.label,
                }),
              )}
            />

            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-border bg-surface px-4 py-10 text-center hover:border-border-strong">
              <FileSpreadsheet size={28} className="text-muted" aria-hidden />
              <span className="font-medium">Choose a CSV file</span>
              <span className="text-sm text-muted">
                The first row must be the column names. Up to 25 MB.
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f !== undefined) chooseFile(f);
                  e.target.value = '';
                }}
              />
            </label>

            {readError !== null && (
              <p className="flex items-start gap-2 rounded-sm border border-border bg-[var(--danger-subtle)] px-3 py-2 text-sm text-danger">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                {readError}
              </p>
            )}

            <p className="text-sm text-faint">
              Contacts, companies and leads can be imported. Deals, tasks and calls are export only.
            </p>
          </>
        )}

        {step === 'map' && (
          <>
            <p className="text-base text-muted">
              {file?.name} · {headers.length} columns. Columns left unmapped are ignored.
            </p>

            <div className="flex flex-col gap-2">
              {headers.map((h) => (
                <div
                  key={h}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{h}</div>
                    <div className="mono truncate text-xs text-faint">
                      {sample
                        .map((r) => r[headers.indexOf(h)] ?? '')
                        .filter((v) => v !== '')
                        .slice(0, 2)
                        .join(' · ') || 'no sample values'}
                    </div>
                  </div>
                  <Select
                    value={columns[h] ?? ''}
                    ariaLabel={`Map ${h}`}
                    size="sm"
                    onChange={(v) => {
                      setColumns((c) => ({ ...c, [h]: v }));
                    }}
                    options={[
                      { value: '', label: 'Ignore this column' },
                      ...Object.entries(fields).map(([key, label]) => ({
                        value: key,
                        label,
                        disabled: mappedFields.includes(key) && columns[h] !== key,
                      })),
                    ]}
                  />
                </div>
              ))}
            </div>

            {!hasRequired && (
              <p className="text-sm text-danger">
                Map a column to {entity === 'company' ? 'Name' : 'First name'} before continuing.
              </p>
            )}
            {hasRequired && !hasContactPoint && (
              <p className="text-sm text-danger">
                Map a phone or an email as well, otherwise the rows cannot be matched to anyone.
              </p>
            )}
          </>
        )}

        {step === 'confirm' && (
          <>
            <Select
              label="If a record already exists"
              value={onDuplicate}
              onChange={(v) => {
                setOnDuplicate(v as 'skip' | 'update');
              }}
              options={[
                {
                  value: 'skip',
                  label: 'Skip the row',
                  description: 'Nothing existing is touched',
                },
                {
                  value: 'update',
                  label: 'Update it',
                  description: 'Mapped fields are overwritten',
                },
              ]}
            />

            <OwnerPicker value={ownerId} onChange={setOwnerId} label="Assign everything to" />

            {entity === 'contact' && (
              <TagInput value={tags} onChange={setTags} label="Tag every imported contact" />
            )}

            <Input
              label="Country for phone numbers"
              mono
              maxLength={2}
              value={country}
              onChange={(e) => {
                setCountry(e.target.value.toUpperCase());
              }}
              description="Used when a number has no country code. Defaults to your workspace setting."
            />

            <div className="rounded-md border border-border bg-surface p-3 text-base">
              <h4 className="mb-1.5 font-medium">What will happen</h4>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-muted">
                <li>
                  {mappedFields.length} of {headers.length} columns will be imported as {entity}s.
                </li>
                <li>
                  Duplicates will be{' '}
                  {onDuplicate === 'skip' ? 'skipped' : 'updated with the mapped fields'}.
                </li>
                <li>
                  Rows that fail validation are reported and can be downloaded as a CSV to fix.
                </li>
                <li>The import runs in the background and cannot be undone in one click.</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

function StepBar({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'file', label: 'File' },
    { id: 'map', label: 'Columns' },
    { id: 'confirm', label: 'Confirm' },
  ];
  const index = steps.findIndex((s) => s.id === step);
  return (
    <ol className="flex items-center gap-2">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2">
          <span
            className={cn(
              'flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-sm',
              i === index
                ? 'border-flare bg-flare-subtle font-medium text-flare-on-subtle'
                : i < index
                  ? 'border-border text-muted'
                  : 'border-border text-faint',
            )}
          >
            {i < index && <Check size={11} aria-hidden />}
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-faint">→</span>}
        </li>
      ))}
      <Badge tone="neutral" className="ml-auto">
        Step {index + 1} of 3
      </Badge>
    </ol>
  );
}
