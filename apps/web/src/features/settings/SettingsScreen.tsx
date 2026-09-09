/**
 * Settings (Settings). One screen, a section list on the left, the section on the right,
 * with the section in the query string so a link goes straight to it.
 *
 * Every business setting here changes behaviour for everyone, so each save says what it will
 * affect rather than just writing the value. Sections the user cannot manage are hidden, not
 * disabled, except where seeing the value is itself useful (PBX status, system health).
 */
import type {
  BackupDto,
  ChannelDto,
  CustomFieldDefinitionDto,
  PipelineDto,
  UserDto,
  WebFormDto,
} from '@crm/shared';
import {
  Activity,
  Building2,
  Check,
  ClipboardCopy,
  Cog,
  Database,
  KeyRound,
  Phone,
  Plus,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
  Workflow,
  HardDriveDownload,
  Pencil,
  Upload,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input, Textarea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Loading';
import { Dialog } from '@/components/ui/Overlay';
import { Select } from '@/components/ui/Select';
import { Checkbox, Switch } from '@/components/ui/Toggle';
import { toast } from '@/components/ui/toast';
import { DataTable, type Column } from '@/components/data/DataTable';
import { DateTime, Identifier } from '@/components/data/formatters';
import { EmptyState, ErrorState, ForbiddenState } from '@/components/data/states';
import { DetailList, Panel } from '@/components/entity/EntityHeader';
import { OwnerPicker } from '@/components/entity/pickers';
import { PageHeader } from '@/app/shell/TopBar';
import { usePageMeta } from '@/app/shell/page-meta';
import { errorMessage } from '@/lib/api/errors';
import { useListState, useSearchParam } from '@/lib/list-state';
import { cn } from '@/lib/utils';
import { useDispositions } from '@/features/telephony/api';
import { useCtiStatus } from '@/features/telephony/api';
import { MAX_PAGE_SIZE } from '@crm/shared';
import { usePipelines } from '@/features/deals/api';
import {
  countPlaceholders,
  templatesOf,
  useChannelMutations,
  useChannels,
  type TemplateDef,
} from '@/features/inbox/api';
import { useCreateUser, useUpdateUser, useUserAction, useUsers } from '@/features/users/api';
import { formatBytes } from '@/lib/api/attachments';
import { usePermissions } from '@/providers/permissions';
import { useFullSettings } from '@/providers/settings';
import {
  useAuditLog,
  useBackupMutations,
  useBackups,
  useCustomFieldMutations,
  useCustomFields,
  useDispositionMutations,
  usePipelineMutations,
  useSystemHealth,
  useUpdateSettings,
  useWebFormMutations,
  useWebForms,
  type AuditFilters,
  type CustomFieldEntity,
} from './api';

interface Section {
  id: string;
  label: string;
  icon: typeof Cog;
  /** Hidden entirely when the user lacks this. */
  requires?:
    | 'settings:read'
    | 'settings:manage'
    | 'custom_field:manage'
    | 'pipeline:manage'
    | 'channel:manage'
    | 'webform:manage'
    | 'audit:read'
    | 'team:read';
}

const SECTIONS: Section[] = [
  { id: 'general', label: 'General', icon: Cog, requires: 'settings:read' },
  { id: 'telephony', label: 'Telephony', icon: Phone, requires: 'settings:read' },
  { id: 'recording', label: 'Recording', icon: Activity, requires: 'settings:read' },
  { id: 'matching', label: 'Number matching', icon: SlidersHorizontal, requires: 'settings:read' },
  { id: 'security', label: 'Security', icon: ShieldCheck, requires: 'settings:read' },
  { id: 'retention', label: 'Data retention', icon: Database, requires: 'settings:read' },
  { id: 'backups', label: 'Backups', icon: HardDriveDownload, requires: 'settings:manage' },
  { id: 'fields', label: 'Custom fields', icon: KeyRound, requires: 'custom_field:manage' },
  { id: 'pipelines', label: 'Pipelines', icon: Workflow, requires: 'pipeline:manage' },
  { id: 'dispositions', label: 'Call outcomes', icon: Check, requires: 'settings:manage' },
  { id: 'channels', label: 'Channels', icon: Building2, requires: 'channel:manage' },
  { id: 'forms', label: 'Web forms', icon: ClipboardCopy, requires: 'webform:manage' },
  { id: 'users', label: 'Users', icon: Users, requires: 'team:read' },
  { id: 'audit', label: 'Audit log', icon: ScrollText, requires: 'audit:read' },
  // /ready only includes the per-check breakdown for admins (docs/08 M4); settings:manage is
  // admin-only, unlike settings:read, which agents and managers also hold.
  { id: 'health', label: 'System health', icon: Activity, requires: 'settings:manage' },
];

export function SettingsScreen() {
  usePageMeta([{ label: 'Settings' }]);
  const perms = usePermissions();
  const [section, setSection] = useSearchParam('section');

  const visible = SECTIONS.filter((s) => s.requires === undefined || perms.has(s.requires));
  const active = visible.find((s) => s.id === section)?.id ?? visible[0]?.id ?? 'general';

  if (visible.length === 0) return <ForbiddenState permission="settings:read" what="Settings" />;

  return (
    <div className="flex flex-col gap-4 p-6">
      <PageHeader
        title="Settings"
        description="How the CRM behaves for everyone in this workspace."
      />

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav
          aria-label="Settings sections"
          className="flex flex-col gap-0.5 lg:sticky lg:top-4 lg:self-start"
        >
          {visible.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={s.id === active ? 'page' : undefined}
              onClick={() => {
                setSection(s.id === visible[0]?.id ? undefined : s.id);
              }}
              className={cn(
                'flex h-8 items-center gap-2 rounded-sm px-2.5 text-left text-base',
                s.id === active
                  ? 'bg-[var(--flare-subtle)] font-medium text-flare-on-subtle'
                  : 'text-muted hover:bg-hover hover:text-fg',
              )}
            >
              <s.icon size={14} className="shrink-0" aria-hidden />
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          {active === 'general' && <GeneralSection />}
          {active === 'telephony' && <TelephonySection />}
          {active === 'recording' && <RecordingSection />}
          {active === 'matching' && <MatchingSection />}
          {active === 'security' && <SecuritySection />}
          {active === 'retention' && <RetentionSection />}
          {active === 'backups' && <BackupsSection />}
          {active === 'fields' && <CustomFieldsSection />}
          {active === 'pipelines' && <PipelinesSection />}
          {active === 'dispositions' && <DispositionsSection />}
          {active === 'channels' && <ChannelsSection />}
          {active === 'forms' && <WebFormsSection />}
          {active === 'users' && <UsersSection />}
          {active === 'audit' && <AuditSection />}
          {active === 'health' && <HealthSection />}
        </div>
      </div>
    </div>
  );
}

/* ── shared plumbing for the value sections ─────────────────────────────────────────────── */

type SettingsPayload = NonNullable<ReturnType<typeof useFullSettings>['data']>;

/**
 * Loads the full settings and gives a section a save function scoped to one key.
 * Saving is never optimistic: these values change behaviour for everyone, so the screen waits for
 * the server to confirm rather than showing a change that might not have landed.
 */
function useSettingsSection<K extends keyof SettingsPayload>(key: K) {
  const perms = usePermissions();
  const query = useFullSettings();
  const update = useUpdateSettings();
  const canManage = perms.has('settings:manage');

  const save = (value: SettingsPayload[K], what: string) => {
    update.mutate(
      { [key]: value },
      {
        onSuccess: () => {
          toast({ tone: 'success', title: 'Settings saved', description: what });
        },
        onError: (e) => {
          toast({ tone: 'danger', title: 'Could not save', description: errorMessage(e) });
        },
      },
    );
  };

  return { query, value: query.data?.[key], save, canManage, saving: update.isPending };
}

function SectionShell({
  title,
  description,
  children,
  loading,
  error,
  onRetry,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  footer?: ReactNode;
}) {
  return (
    <Panel title={title} note={description}>
      {loading === true ? (
        <Skeleton height={140} shape="block" />
      ) : error !== undefined && error !== null ? (
        <ErrorState message={errorMessage(error)} {...(onRetry !== undefined ? { onRetry } : {})} />
      ) : (
        <div className="flex flex-col gap-4">
          {children}
          {footer}
        </div>
      )}
    </Panel>
  );
}

/* ── general ────────────────────────────────────────────────────────────────────────────── */

function GeneralSection() {
  const country = useSettingsSection('defaultCountry');
  const currency = useSettingsSection('currency');
  const visibility = useSettingsSection('agentVisibility');
  const [draftCountry, setDraftCountry] = useState<string | null>(null);
  const [draftCurrency, setDraftCurrency] = useState<string | null>(null);

  const loading = country.query.isPending;

  return (
    <SectionShell
      title="General"
      description="GET /settings · PATCH /settings"
      loading={loading}
      error={country.query.error}
      onRetry={() => {
        void country.query.refetch();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Default country"
          description="Two letter code. Numbers typed without a country code are read as this country."
          mono
          maxLength={2}
          disabled={!country.canManage}
          value={draftCountry ?? country.value ?? ''}
          onChange={(e) => {
            setDraftCountry(e.target.value.toUpperCase());
          }}
          onBlur={() => {
            if (
              draftCountry !== null &&
              draftCountry.length === 2 &&
              draftCountry !== country.value
            ) {
              country.save(draftCountry, `Numbers now default to ${draftCountry}`);
            }
            setDraftCountry(null);
          }}
        />
        <Input
          label="Currency"
          description="Three letter code used for every deal value."
          mono
          maxLength={3}
          disabled={!currency.canManage}
          value={draftCurrency ?? currency.value ?? ''}
          onChange={(e) => {
            setDraftCurrency(e.target.value.toUpperCase());
          }}
          onBlur={() => {
            if (
              draftCurrency !== null &&
              draftCurrency.length === 3 &&
              draftCurrency !== currency.value
            ) {
              currency.save(draftCurrency, `Deal values now show in ${draftCurrency}`);
            }
            setDraftCurrency(null);
          }}
        />
      </div>

      <Select
        label="What an agent can see"
        description="Applies to contacts, companies, deals, leads and calls. Managers and admins always see everything in scope."
        disabled={!visibility.canManage}
        value={visibility.value ?? 'owned'}
        onChange={(v) => {
          visibility.save(
            v as never,
            v === 'owned'
              ? 'Agents now see only records they own'
              : v === 'team'
                ? 'Agents now see their team’s records'
                : 'Agents now see every record',
          );
        }}
        options={[
          { value: 'owned', label: 'Only what they own', description: 'The tightest option' },
          { value: 'team', label: 'Their team’s records' },
          { value: 'all', label: 'Everything' },
        ]}
      />
    </SectionShell>
  );
}

/* ── telephony ──────────────────────────────────────────────────────────────────────────── */

function TelephonySection() {
  const perms = usePermissions();
  const dial = useSettingsSection('dialRules');
  const popup = useSettingsSection('popup');
  const status = useCtiStatus(perms.has('pbx:view_status'));
  const [draft, setDraft] = useState<SettingsPayload['dialRules'] | null>(null);

  const rules = draft ?? dial.value;

  return (
    <>
      {perms.has('pbx:view_status') && (
        <Panel title="PBX connection" note="GET /cti/status">
          {status.isPending ? (
            <Skeleton height={100} shape="block" />
          ) : status.isError ? (
            <ErrorState
              message={errorMessage(status.error)}
              onRetry={() => {
                void status.refetch();
              }}
            />
          ) : (
            <DetailList
              items={[
                {
                  label: 'Status',
                  value: (
                    <Badge tone={status.data.connected ? 'success' : 'danger'}>
                      {status.data.connected ? 'Connected' : 'Disconnected'}
                    </Badge>
                  ),
                },
                {
                  label: 'Event source',
                  value: <span className="mono">{status.data.eventSource}</span>,
                },
                {
                  label: 'Leader',
                  value: <span className="mono">{status.data.leader ?? '—'}</span>,
                },
                { label: 'Connected since', value: <DateTime value={status.data.since} /> },
                { label: 'Last event', value: <DateTime value={status.data.lastEventAt} /> },
                { label: 'Token expires', value: <DateTime value={status.data.tokenExpiresAt} /> },
                {
                  label: 'Live calls',
                  value: <span className="mono">{status.data.liveCalls}</span>,
                },
              ]}
            />
          )}
        </Panel>
      )}

      <SectionShell
        title="Dial rules"
        description="How an E.164 number is turned into what the PBX actually dials."
        loading={dial.query.isPending}
        error={dial.query.error}
        footer={
          draft !== null && (
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                loading={dial.saving}
                onClick={() => {
                  dial.save(draft, 'Outbound dialling now uses the new rules');
                  setDraft(null);
                }}
              >
                Save dial rules
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(null);
                }}
              >
                Discard
              </Button>
            </div>
          )
        }
      >
        {rules !== undefined && (
          <>
            <Switch
              checked={rules.stripPlus}
              disabled={!dial.canManage}
              onChange={(v) => {
                setDraft({ ...rules, stripPlus: v });
              }}
              label="Strip the leading plus"
              description="Most PBX trunks reject a leading + on an outbound number."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Outbound prefix"
                mono
                maxLength={8}
                disabled={!dial.canManage}
                description="Dialled before the number, e.g. 9 or 0. Leave blank if the trunk needs none."
                value={rules.outboundPrefix}
                onChange={(e) => {
                  setDraft({ ...rules, outboundPrefix: e.target.value });
                }}
              />
              <Input
                label="Internal extension length"
                type="number"
                min={2}
                max={8}
                mono
                disabled={!dial.canManage}
                description="Anything this short is treated as an extension, not an outside line."
                value={String(rules.internalExtensionLength)}
                onChange={(e) => {
                  setDraft({ ...rules, internalExtensionLength: Number(e.target.value) });
                }}
              />
            </div>
            <Select
              label="Dial E.164 numbers as"
              disabled={!dial.canManage}
              value={rules.e164ToDialable}
              onChange={(v) => {
                setDraft({ ...rules, e164ToDialable: v as 'national' | 'international' });
              }}
              options={[
                {
                  value: 'national',
                  label: 'National',
                  description: '+254712345678 becomes 0712345678',
                },
                {
                  value: 'international',
                  label: 'International',
                  description: 'Kept as the full number',
                },
              ]}
            />
            <Input
              label="Dial permission extension"
              mono
              maxLength={16}
              disabled={!dial.canManage}
              description="Optional. The extension the API uses when it places a call on someone's behalf."
              value={rules.dialPermissionExtension ?? ''}
              onChange={(e) => {
                setDraft({
                  ...rules,
                  dialPermissionExtension: e.target.value === '' ? null : e.target.value,
                });
              }}
            />
          </>
        )}
      </SectionShell>

      <SectionShell
        title="Call popup"
        description="What happens on screen when a call arrives."
        loading={popup.query.isPending}
        error={popup.query.error}
      >
        {popup.value !== undefined && (
          <>
            <Switch
              checked={popup.value.popOnInternalCalls}
              disabled={!popup.canManage}
              onChange={(v) => {
                popup.save(
                  { ...popup.value, popOnInternalCalls: v } as never,
                  'Internal call popups changed',
                );
              }}
              label="Pop on internal calls"
              description="Off by default: extension to extension calls rarely need a screen pop."
            />
            <Switch
              checked={popup.value.autoOpenProfileOnAnswer}
              disabled={!popup.canManage}
              onChange={(v) => {
                popup.save(
                  { ...popup.value, autoOpenProfileOnAnswer: v } as never,
                  'Auto open on answer changed',
                );
              }}
              label="Open the contact when the call is answered"
              description="Navigates away from whatever the agent was doing, so it is off by default."
            />
            <Switch
              checked={popup.value.suggestFollowUpAfterCall}
              disabled={!popup.canManage}
              onChange={(v) => {
                popup.save(
                  { ...popup.value, suggestFollowUpAfterCall: v } as never,
                  'Follow-up suggestion changed',
                );
              }}
              label="Suggest a follow-up task after a call"
              description="Pre-ticks the follow-up box on the disposition form."
            />
          </>
        )}
      </SectionShell>
    </>
  );
}

/* ── recording ──────────────────────────────────────────────────────────────────────────── */

function RecordingSection() {
  const recording = useSettingsSection('recording');
  const [draft, setDraft] = useState<SettingsPayload['recording'] | null>(null);
  const value = draft ?? recording.value;

  return (
    <SectionShell
      title="Call recording"
      description="Consent wording, who may listen, and how long audio is kept."
      loading={recording.query.isPending}
      error={recording.query.error}
      footer={
        draft !== null && (
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              loading={recording.saving}
              onClick={() => {
                recording.save(draft, 'Recording settings updated');
                setDraft(null);
              }}
            >
              Save
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(null);
              }}
            >
              Discard
            </Button>
          </div>
        )
      }
    >
      {value !== undefined && (
        <>
          <Textarea
            label="Consent text"
            rows={3}
            maxLength={2000}
            disabled={!recording.canManage}
            description="Shown to agents on the call popup. It is what your callers were told, so keep it accurate."
            value={value.consentText}
            onChange={(e) => {
              setDraft({ ...value, consentText: e.target.value });
            }}
          />
          <Switch
            checked={value.allowAgentPlayback}
            disabled={!recording.canManage}
            onChange={(v) => {
              setDraft({ ...value, allowAgentPlayback: v });
            }}
            label="Agents may play back recordings"
            description="Managers and admins can always listen. Every play is written to the audit log."
          />
          <Input
            label="Keep recordings for"
            type="number"
            min={1}
            max={3650}
            mono
            suffix={<span className="text-sm text-muted">days</span>}
            disabled={!recording.canManage}
            description="Older audio is deleted by the retention job. The call record itself is kept."
            value={String(value.retentionDays)}
            onChange={(e) => {
              setDraft({ ...value, retentionDays: Number(e.target.value) });
            }}
          />
        </>
      )}
    </SectionShell>
  );
}

/* ── matching ───────────────────────────────────────────────────────────────────────────── */

function MatchingSection() {
  const matching = useSettingsSection('matching');
  const value = matching.value;

  return (
    <SectionShell
      title="Number matching"
      description="How an incoming number is matched to a contact."
      loading={matching.query.isPending}
      error={matching.query.error}
    >
      {value !== undefined && (
        <>
          <Switch
            checked={value.allowSuffixMatch}
            disabled={!matching.canManage}
            onChange={(v) => {
              matching.save(
                { ...value, allowSuffixMatch: v },
                v ? 'Suffix matching is now on' : 'Only exact numbers will match',
              );
            }}
            label="Match on the last digits"
            description="Catches numbers stored without a country code. It can also match the wrong contact, so it is off by default."
          />
          <Input
            label="Digits to compare"
            type="number"
            min={6}
            max={10}
            mono
            disabled={!matching.canManage || !value.allowSuffixMatch}
            description="Fewer digits means more false matches. Nine is right for Kenyan mobile numbers."
            value={String(value.suffixLength)}
            onChange={(e) => {
              matching.save(
                { ...value, suffixLength: Number(e.target.value) },
                `Now comparing the last ${e.target.value} digits`,
              );
            }}
          />
        </>
      )}
    </SectionShell>
  );
}

/* ── security ───────────────────────────────────────────────────────────────────────────── */

function SecuritySection() {
  const security = useSettingsSection('security');
  const value = security.value;

  return (
    <SectionShell
      title="Security"
      description="Two-factor requirements and how long an idle session lasts."
      loading={security.query.isPending}
      error={security.query.error}
    >
      {value !== undefined && (
        <>
          <Switch
            checked={value.require2FAForPrivileged}
            disabled={!security.canManage}
            onChange={(v) => {
              security.save(
                { ...value, require2FAForPrivileged: v },
                v
                  ? 'Admins and managers must now use 2FA'
                  : '2FA is no longer required for admins and managers',
              );
            }}
            label="Require 2FA for admins and managers"
            description="They will be asked to enrol at their next sign-in."
          />
          <Switch
            checked={value.require2FAForAll}
            disabled={!security.canManage}
            onChange={(v) => {
              security.save(
                { ...value, require2FAForAll: v },
                v ? 'Everyone must now use 2FA' : '2FA is now optional for agents',
              );
            }}
            label="Require 2FA for everyone"
            description="Every agent will be asked to enrol before they can use the CRM again."
          />
          <Input
            label="Sign out after"
            type="number"
            min={5}
            max={720}
            mono
            suffix={<span className="text-sm text-muted">minutes idle</span>}
            disabled={!security.canManage}
            description="A warning appears a minute before. Agents on the phone all day notice a short timeout."
            value={String(value.sessionIdleMinutes)}
            onChange={(e) => {
              security.save(
                { ...value, sessionIdleMinutes: Number(e.target.value) },
                `Idle sign-out set to ${e.target.value} minutes`,
              );
            }}
          />
        </>
      )}
    </SectionShell>
  );
}

/* ── retention ──────────────────────────────────────────────────────────────────────────── */

function RetentionSection() {
  const retention = useSettingsSection('retention');
  const [draft, setDraft] = useState<SettingsPayload['retention'] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const value = draft ?? retention.value;

  return (
    <SectionShell
      title="Data retention"
      description="What the nightly purge deletes. Shortening a window deletes data at the next run."
      loading={retention.query.isPending}
      error={retention.query.error}
      footer={
        draft !== null && (
          <>
            <div className="flex items-center gap-2">
              <Button
                variant="danger"
                onClick={() => {
                  setConfirm(true);
                }}
              >
                Save retention
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(null);
                }}
              >
                Discard
              </Button>
            </div>
            <ConfirmDialog
              open={confirm}
              onOpenChange={setConfirm}
              title="Change retention?"
              description="The purge job runs nightly and deletes anything already past the new window."
              confirmLabel="Save retention"
              tone="danger"
              consequences={[
                'Deleted rows cannot be restored',
                'Shortening a window takes effect at the next nightly run',
              ]}
              loading={retention.saving}
              onConfirm={() => {
                retention.save(draft, 'Retention windows updated');
                setDraft(null);
                setConfirm(false);
              }}
            />
          </>
        )
      }
    >
      {value !== undefined && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            label="Purge deleted records after"
            type="number"
            min={1}
            max={3650}
            mono
            suffix={<span className="text-sm text-muted">days</span>}
            disabled={!retention.canManage}
            description="How long a soft deleted contact or deal can still be restored."
            value={String(value.softDeletePurgeDays)}
            onChange={(e) => {
              setDraft({ ...value, softDeletePurgeDays: Number(e.target.value) });
            }}
          />
          <Input
            label="Keep raw PBX events for"
            type="number"
            min={1}
            max={365}
            mono
            suffix={<span className="text-sm text-muted">days</span>}
            disabled={!retention.canManage}
            description="Only used for debugging a call that went wrong."
            value={String(value.pbxEventsDays)}
            onChange={(e) => {
              setDraft({ ...value, pbxEventsDays: Number(e.target.value) });
            }}
          />
          <Input
            label="Keep raw message payloads for"
            type="number"
            min={1}
            max={3650}
            mono
            suffix={<span className="text-sm text-muted">days</span>}
            disabled={!retention.canManage}
            description="The provider payload behind each message. The message itself is kept."
            value={String(value.rawMessagePayloadDays)}
            onChange={(e) => {
              setDraft({ ...value, rawMessagePayloadDays: Number(e.target.value) });
            }}
          />
        </div>
      )}
    </SectionShell>
  );
}

/* ── custom fields ──────────────────────────────────────────────────────────────────────── */

const FIELD_ENTITIES: { value: CustomFieldEntity; label: string }[] = [
  { value: 'contact', label: 'Contacts' },
  { value: 'company', label: 'Companies' },
  { value: 'deal', label: 'Deals' },
  { value: 'lead', label: 'Leads' },
];

function CustomFieldsSection() {
  const [entity, setEntity] = useState<CustomFieldEntity>('contact');
  const query = useCustomFields(entity);
  const { create, update, remove } = useCustomFieldMutations();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<CustomFieldDefinitionDto | null>(null);

  const rows = query.data ?? [];

  return (
    <>
      <Panel
        title="Custom fields"
        note="GET /custom-fields · the key cannot change once a field exists, because data is stored under it"
        padded={false}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={Plus}
            onClick={() => {
              setCreateOpen(true);
            }}
          >
            New field
          </Button>
        }
      >
        <div className="border-b border-border px-3.5 py-2.5">
          <Select
            value={entity}
            onChange={(v) => {
              setEntity(v as CustomFieldEntity);
            }}
            size="sm"
            ariaLabel="Entity"
            options={FIELD_ENTITIES}
            className="max-w-48"
          />
        </div>

        {query.isPending ? (
          <div className="p-3">
            <Skeleton height={120} shape="block" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            object="sim"
            title="No custom fields yet"
            description="Add the one thing your team keeps writing in the notes."
            primaryAction={{
              label: 'New field',
              onClick: () => {
                setCreateOpen(true);
              },
            }}
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{f.label}</span>
                  <span className="mono block truncate text-sm text-faint">
                    {f.key} · {f.type}
                    {f.required && ' · required'}
                  </span>
                </span>
                <Switch
                  checked={f.isActive}
                  ariaLabel={`${f.label} is active`}
                  onChange={(v) => {
                    update.mutate(
                      { id: f.id, body: { isActive: v } },
                      {
                        onError: (e) => {
                          toast({
                            tone: 'danger',
                            title: 'Could not update',
                            description: errorMessage(e),
                          });
                        },
                      },
                    );
                  }}
                />
                <IconButton
                  icon={Trash2}
                  label={`Delete ${f.label}`}
                  size={26}
                  variant="ghost"
                  onClick={() => {
                    setDeleting(f);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <CustomFieldDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        entity={entity}
        onCreate={(body) => {
          create.mutate(body, {
            onSuccess: () => {
              toast({ tone: 'success', title: 'Custom field created' });
              setCreateOpen(false);
            },
            onError: (e) => {
              toast({
                tone: 'danger',
                title: 'Could not create the field',
                description: errorMessage(e),
              });
            },
          });
        }}
        pending={create.isPending}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => {
          if (!v) setDeleting(null);
        }}
        title={deleting === null ? 'Delete field?' : `Delete ${deleting.label}?`}
        description="The definition is removed. Values already stored under this key stop being shown."
        confirmLabel="Delete field"
        tone="danger"
        consequences={[
          'Existing values are not displayed anywhere after this',
          'This cannot be undone',
        ]}
        loading={remove.isPending}
        onConfirm={() => {
          if (deleting === null) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast({ tone: 'success', title: 'Field deleted' });
              setDeleting(null);
            },
            onError: (e) => {
              toast({ tone: 'danger', title: 'Could not delete', description: errorMessage(e) });
            },
          });
        }}
      />
    </>
  );
}

function CustomFieldDialog({
  open,
  onOpenChange,
  entity,
  onCreate,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entity: CustomFieldEntity;
  onCreate: (body: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [type, setType] = useState('text');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState('');
  const needsOptions = type === 'select' || type === 'multiselect';

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New custom field"
      description="POST /custom-fields"
      width={460}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={label.trim() === '' || key.trim() === ''}
            onClick={() => {
              onCreate({
                entity,
                key: key.trim(),
                label: label.trim(),
                type,
                required,
                ...(needsOptions
                  ? {
                      options: options
                        .split('\n')
                        .map((l) => l.trim())
                        .filter((l) => l !== '')
                        .map((l) => ({ value: l.toLowerCase().replace(/\s+/g, '_'), label: l })),
                    }
                  : {}),
              });
            }}
          >
            Create field
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          autoFocus
          label="Label"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            if (key === '') {
              setKey(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '_')
                  .replace(/^_+|_+$/g, ''),
              );
            }
          }}
        />
        <Input
          label="Key"
          mono
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
          }}
          description="snake_case, 2 to 40 characters. This cannot be changed later."
        />
        <Select
          label="Type"
          value={type}
          onChange={setType}
          options={[
            { value: 'text', label: 'Text' },
            { value: 'textarea', label: 'Long text' },
            { value: 'number', label: 'Number' },
            { value: 'date', label: 'Date' },
            { value: 'datetime', label: 'Date and time' },
            { value: 'boolean', label: 'Yes or no' },
            { value: 'select', label: 'Single choice' },
            { value: 'multiselect', label: 'Multiple choice' },
            { value: 'url', label: 'URL' },
            { value: 'email', label: 'Email' },
            { value: 'phone', label: 'Phone' },
          ]}
        />
        {needsOptions && (
          <Textarea
            label="Options"
            rows={4}
            value={options}
            onChange={(e) => {
              setOptions(e.target.value);
            }}
            description="One per line."
          />
        )}
        <Checkbox checked={required} onChange={setRequired} label="Required" />
      </div>
    </Dialog>
  );
}

/* ── pipelines ──────────────────────────────────────────────────────────────────────────── */

function PipelinesSection() {
  const pipelines = usePipelines();
  const { create, update, addStage, updateStage, removeStage } = usePipelineMutations();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [stageFor, setStageFor] = useState<PipelineDto | null>(null);
  const [stageName, setStageName] = useState('');
  const [stageProbability, setStageProbability] = useState('50');
  const [removingStage, setRemovingStage] = useState<{
    pipeline: PipelineDto;
    stageId: string;
    name: string;
  } | null>(null);
  const [reassignTo, setReassignTo] = useState<string | null>(null);

  const rows = pipelines.data ?? [];

  return (
    <>
      {pipelines.isPending ? (
        <Skeleton height={200} shape="block" />
      ) : rows.length === 0 ? (
        <EmptyState
          object="pipeline"
          title="No pipelines yet"
          description="A pipeline is the set of stages a deal moves through."
          primaryAction={{
            label: 'New pipeline',
            onClick: () => {
              setCreateOpen(true);
            },
          }}
        />
      ) : (
        rows.map((p) => (
          <Panel
            key={p.id}
            title={
              <span className="flex items-center gap-2">
                {p.name}
                {p.isDefault && <Badge tone="neutral">Default</Badge>}
              </span>
            }
            note={`${String(p.stages.length)} stages · PATCH /pipelines/${p.id}`}
            padded={false}
            actions={
              <>
                {!p.isDefault && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      update.mutate(
                        { id: p.id, body: { isDefault: true } },
                        {
                          onSuccess: () => {
                            toast({
                              tone: 'success',
                              title: `${p.name} is now the default pipeline`,
                            });
                          },
                          onError: (e) => {
                            toast({
                              tone: 'danger',
                              title: 'Could not update',
                              description: errorMessage(e),
                            });
                          },
                        },
                      );
                    }}
                  >
                    Make default
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Plus}
                  onClick={() => {
                    setStageFor(p);
                    setStageName('');
                    setStageProbability('50');
                  }}
                >
                  Stage
                </Button>
              </>
            }
          >
            <ul className="divide-y divide-border">
              {p.stages.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <Badge
                    tone={s.type === 'won' ? 'success' : s.type === 'lost' ? 'danger' : 'neutral'}
                  >
                    {s.type}
                  </Badge>
                  <span className="mono w-12 text-right text-sm text-muted">{s.probability}%</span>
                  <Switch
                    checked={s.isActive}
                    ariaLabel={`${s.name} is active`}
                    onChange={(v) => {
                      updateStage.mutate(
                        { id: p.id, stageId: s.id, body: { isActive: v } },
                        {
                          onError: (e) => {
                            toast({
                              tone: 'danger',
                              title: 'Could not update the stage',
                              description: errorMessage(e),
                            });
                          },
                        },
                      );
                    }}
                  />
                  <IconButton
                    icon={Trash2}
                    label={`Delete ${s.name}`}
                    size={26}
                    variant="ghost"
                    disabled={p.stages.length <= 2}
                    onClick={() => {
                      setRemovingStage({ pipeline: p, stageId: s.id, name: s.name });
                      setReassignTo(p.stages.find((x) => x.id !== s.id)?.id ?? null);
                    }}
                  />
                </li>
              ))}
            </ul>
          </Panel>
        ))
      )}

      <Button
        variant="secondary"
        icon={Plus}
        className="self-start"
        onClick={() => {
          setCreateOpen(true);
        }}
      >
        New pipeline
      </Button>

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New pipeline"
        description="POST /pipelines · it starts with a default set of stages you can then edit"
        width={420}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCreateOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={create.isPending}
              disabled={name.trim() === ''}
              onClick={() => {
                create.mutate(
                  { name: name.trim() },
                  {
                    onSuccess: () => {
                      toast({ tone: 'success', title: 'Pipeline created' });
                      setCreateOpen(false);
                      setName('');
                    },
                    onError: (e) => {
                      toast({
                        tone: 'danger',
                        title: 'Could not create',
                        description: errorMessage(e),
                      });
                    },
                  },
                );
              }}
            >
              Create
            </Button>
          </>
        }
      >
        <Input
          autoFocus
          label="Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Dialog>

      <Dialog
        open={stageFor !== null}
        onOpenChange={(v) => {
          if (!v) setStageFor(null);
        }}
        title="Add a stage"
        description="POST /pipelines/:id/stages"
        width={420}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setStageFor(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={addStage.isPending}
              disabled={stageName.trim() === ''}
              onClick={() => {
                if (stageFor === null) return;
                addStage.mutate(
                  {
                    id: stageFor.id,
                    body: {
                      name: stageName.trim(),
                      probability: Number(stageProbability),
                      type: 'open',
                    },
                  },
                  {
                    onSuccess: () => {
                      toast({ tone: 'success', title: 'Stage added' });
                      setStageFor(null);
                    },
                    onError: (e) => {
                      toast({
                        tone: 'danger',
                        title: 'Could not add the stage',
                        description: errorMessage(e),
                      });
                    },
                  },
                );
              }}
            >
              Add stage
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            label="Stage name"
            value={stageName}
            onChange={(e) => {
              setStageName(e.target.value);
            }}
          />
          <Input
            label="Probability"
            type="number"
            min={0}
            max={100}
            mono
            suffix={<span className="text-sm text-muted">%</span>}
            value={stageProbability}
            onChange={(e) => {
              setStageProbability(e.target.value);
            }}
            description="Used for the weighted pipeline value and the forecast."
          />
        </div>
      </Dialog>

      <Dialog
        open={removingStage !== null}
        onOpenChange={(v) => {
          if (!v) setRemovingStage(null);
        }}
        title={removingStage === null ? 'Delete stage' : `Delete ${removingStage.name}?`}
        description="Deals in this stage have to go somewhere."
        width={440}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setRemovingStage(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={removeStage.isPending}
              onClick={() => {
                if (removingStage === null) return;
                removeStage.mutate(
                  {
                    id: removingStage.pipeline.id,
                    stageId: removingStage.stageId,
                    ...(reassignTo !== null ? { reassignToStageId: reassignTo } : {}),
                  },
                  {
                    onSuccess: () => {
                      toast({ tone: 'success', title: 'Stage deleted' });
                      setRemovingStage(null);
                    },
                    onError: (e) => {
                      toast({
                        tone: 'danger',
                        title: 'Could not delete the stage',
                        description: errorMessage(e),
                      });
                    },
                  },
                );
              }}
            >
              Delete stage
            </Button>
          </>
        }
      >
        {removingStage !== null && (
          <Select
            label="Move its deals to"
            value={reassignTo}
            onChange={setReassignTo}
            options={removingStage.pipeline.stages
              .filter((s) => s.id !== removingStage.stageId)
              .map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
      </Dialog>
    </>
  );
}

/* ── dispositions ───────────────────────────────────────────────────────────────────────── */

function DispositionsSection() {
  const dispositions = useDispositions();
  const { create, update, remove } = useDispositionMutations();
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  const rows = dispositions.data ?? [];

  return (
    <>
      <Panel
        title="Call outcomes"
        note="GET /call-dispositions · these are the chips an agent picks after a call"
        padded={false}
      >
        {dispositions.isPending ? (
          <div className="p-3">
            <Skeleton height={120} shape="block" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            object="checkmark"
            title="No outcomes yet"
            description="Add the handful your team actually uses. Too many and nobody picks one."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                {d.isSystem && <Badge tone="neutral">Built in</Badge>}
                <Switch
                  checked={d.isActive}
                  ariaLabel={`${d.name} is active`}
                  onChange={(v) => {
                    update.mutate(
                      { id: d.id, body: { isActive: v } },
                      {
                        onError: (e) => {
                          toast({
                            tone: 'danger',
                            title: 'Could not update',
                            description: errorMessage(e),
                          });
                        },
                      },
                    );
                  }}
                />
                <IconButton
                  icon={Trash2}
                  label={`Delete ${d.name}`}
                  size={26}
                  variant="ghost"
                  disabled={d.isSystem}
                  onClick={() => {
                    setDeleting({ id: d.id, name: d.name });
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="flex items-end gap-2">
        <Input
          label="Add an outcome"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          className="max-w-64"
        />
        <Button
          variant="secondary"
          icon={Plus}
          loading={create.isPending}
          disabled={name.trim() === ''}
          onClick={() => {
            create.mutate(
              { name: name.trim() },
              {
                onSuccess: () => {
                  toast({ tone: 'success', title: 'Outcome added' });
                  setName('');
                },
                onError: (e) => {
                  toast({ tone: 'danger', title: 'Could not add', description: errorMessage(e) });
                },
              },
            );
          }}
        >
          Add
        </Button>
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => {
          if (!v) setDeleting(null);
        }}
        title={deleting === null ? 'Delete outcome?' : `Delete ${deleting.name}?`}
        description="Calls already tagged with it keep the tag. It stops being offered on new calls."
        confirmLabel="Delete outcome"
        loading={remove.isPending}
        onConfirm={() => {
          if (deleting === null) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast({ tone: 'success', title: 'Outcome deleted' });
              setDeleting(null);
            },
            onError: (e) => {
              toast({ tone: 'danger', title: 'Could not delete', description: errorMessage(e) });
            },
          });
        }}
      />
    </>
  );
}

/* ── channels ───────────────────────────────────────────────────────────────────────────── */

const CHANNEL_TYPES: { value: ChannelDto['type']; label: string; hint: string }[] = [
  {
    value: 'whatsapp',
    label: 'WhatsApp',
    hint: 'The number and credentials are set on the server (docs/11); this names the channel and holds its reply templates.',
  },
  {
    value: 'sms',
    label: 'SMS',
    hint: 'A provider account for sending and receiving text messages.',
  },
  { value: 'livechat', label: 'Live chat', hint: 'A website chat widget.' },
  {
    value: 'yeastar',
    label: 'Yeastar omnichannel',
    hint: "The PBX's own messaging, via the same Open API token as telephony.",
  },
];

function channelTypeLabel(type: ChannelDto['type']): string {
  return CHANNEL_TYPES.find((t) => t.value === type)?.label ?? type;
}

function ChannelsSection() {
  const channels = useChannels();
  const { create, update } = useChannelMutations();
  const [createOpen, setCreateOpen] = useState(false);
  const [type, setType] = useState<ChannelDto['type']>('whatsapp');
  const [name, setName] = useState('');
  const [externalId, setExternalId] = useState('');
  const [editing, setEditing] = useState<ChannelDto | null>(null);

  const rows = channels.data ?? [];

  return (
    <>
      <Panel
        title="Messaging channels"
        note="GET /channels · secrets are stored encrypted and never returned, so they can only be replaced, not read"
        padded={false}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={Plus}
            onClick={() => {
              setCreateOpen(true);
            }}
          >
            New channel
          </Button>
        }
      >
        {channels.isPending ? (
          <div className="p-3">
            <Skeleton height={120} shape="block" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            object="chat-bubble"
            title="No channels configured"
            description="A WhatsApp or SMS channel connects the inbox to a provider."
            primaryAction={{
              label: 'New channel',
              onClick: () => {
                setCreateOpen(true);
              },
            }}
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="mono block truncate text-sm text-faint">
                    {channelTypeLabel(c.type)}
                    {c.externalId !== null && ` · ${c.externalId}`}
                  </span>
                </span>
                {c.hasSecrets ? (
                  <Badge tone="success">Credentials set</Badge>
                ) : (
                  <Badge tone="warning">No credentials</Badge>
                )}
                <Switch
                  checked={c.isActive}
                  ariaLabel={`${c.name} is active`}
                  onChange={(v) => {
                    update.mutate(
                      { id: c.id, body: { isActive: v } },
                      {
                        onError: (e) => {
                          toast({
                            tone: 'danger',
                            title: 'Could not update',
                            description: errorMessage(e),
                          });
                        },
                      },
                    );
                  }}
                />
                <IconButton
                  icon={Pencil}
                  label={`Edit ${c.name}`}
                  size={26}
                  variant="ghost"
                  onClick={() => {
                    setEditing(c);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New channel"
        description="POST /channels"
        width={440}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCreateOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={create.isPending}
              disabled={name.trim() === ''}
              onClick={() => {
                create.mutate(
                  {
                    type,
                    name: name.trim(),
                    externalId: externalId.trim() === '' ? null : externalId.trim(),
                  },
                  {
                    onSuccess: () => {
                      toast({ tone: 'success', title: 'Channel created' });
                      setCreateOpen(false);
                      setName('');
                      setExternalId('');
                    },
                    onError: (e) => {
                      toast({
                        tone: 'danger',
                        title: 'Could not create the channel',
                        description: errorMessage(e),
                      });
                    },
                  },
                );
              }}
            >
              Create channel
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Select
            label="Type"
            value={type}
            onChange={(v) => {
              setType(v as ChannelDto['type']);
            }}
            options={CHANNEL_TYPES.map((t) => ({ value: t.value, label: t.label }))}
          />
          <p className="text-sm text-faint">{CHANNEL_TYPES.find((t) => t.value === type)?.hint}</p>
          <Input
            autoFocus
            label="Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            description="Shown to agents in the inbox as the source of a conversation."
          />
          <Input
            label="External ID"
            value={externalId}
            onChange={(e) => {
              setExternalId(e.target.value);
            }}
            description="Optional. A number or provider account id, for your own reference."
          />
        </div>
      </Dialog>

      {editing !== null && (
        <ChannelEditDialog
          channel={editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Name, external id and, for WhatsApp, the reply templates the composer offers outside the
 * twenty-four hour window (`config.templates`; see `templatesOf` in inbox/api.ts, formerly
 * GAP-05). Meta approves templates and exposes no list endpoint, so recording them here is the
 * only way the composer learns about one at all.
 */
function ChannelEditDialog({ channel, onClose }: { channel: ChannelDto; onClose: () => void }) {
  const { update } = useChannelMutations();
  const [name, setName] = useState(channel.name);
  const [externalId, setExternalId] = useState(channel.externalId ?? '');
  const [templates, setTemplates] = useState<TemplateDef[]>(() => templatesOf(channel));

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={`Edit ${channel.name}`}
      description="PATCH /channels/:id"
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={update.isPending}
            disabled={name.trim() === ''}
            onClick={() => {
              const config: Record<string, unknown> = {
                ...channel.config,
                ...(channel.type === 'whatsapp'
                  ? {
                      templates: templates
                        .filter((t) => t.name.trim() !== '')
                        .map((t) => ({
                          name: t.name.trim(),
                          language: t.language.trim() === '' ? 'en' : t.language.trim(),
                          ...(t.body !== undefined && t.body.trim() !== '' ? { body: t.body } : {}),
                          params: t.params,
                        })),
                    }
                  : {}),
              };
              update.mutate(
                {
                  id: channel.id,
                  body: {
                    name: name.trim(),
                    externalId: externalId.trim() === '' ? null : externalId.trim(),
                    config,
                  },
                },
                {
                  onSuccess: () => {
                    toast({ tone: 'success', title: 'Channel updated' });
                    onClose();
                  },
                  onError: (e) => {
                    toast({
                      tone: 'danger',
                      title: 'Could not save',
                      description: errorMessage(e),
                    });
                  },
                },
              );
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          autoFocus
          label="Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <Input
          label="External ID"
          value={externalId}
          onChange={(e) => {
            setExternalId(e.target.value);
          }}
        />

        {channel.type === 'whatsapp' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Reply templates</span>
              <Button
                variant="ghost"
                size="sm"
                icon={Plus}
                onClick={() => {
                  setTemplates((prev) => [...prev, { name: '', language: 'en', params: 0 }]);
                }}
              >
                Add template
              </Button>
            </div>
            <p className="text-sm text-faint">
              Only templates Meta has approved will actually send. Match the name exactly.
            </p>
            {templates.length === 0 ? (
              <p className="text-sm text-muted">
                None recorded. Outside the twenty-four hour reply window the composer will say so
                rather than offer one.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {templates.map((t, i) => (
                  <li
                    // rows have no stable id until saved, so the index is the key
                    key={i}
                    className="flex flex-col gap-2 rounded-sm border border-border p-2.5"
                  >
                    <div className="flex gap-2">
                      <Input
                        className="flex-1"
                        label="Name"
                        value={t.name}
                        onChange={(e) => {
                          const v = e.target.value;
                          setTemplates((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, name: v } : x)),
                          );
                        }}
                      />
                      <Input
                        label="Language"
                        value={t.language}
                        onChange={(e) => {
                          const v = e.target.value;
                          setTemplates((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, language: v } : x)),
                          );
                        }}
                      />
                      <IconButton
                        icon={Trash2}
                        label="Remove template"
                        size={26}
                        variant="ghost"
                        className="mt-6"
                        onClick={() => {
                          setTemplates((prev) => prev.filter((_, j) => j !== i));
                        }}
                      />
                    </div>
                    <Textarea
                      label="Body"
                      rows={2}
                      value={t.body ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setTemplates((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, body: v, params: countPlaceholders(v) } : x,
                          ),
                        );
                      }}
                      description={`${String(countPlaceholders(t.body))} placeholder(s) detected, e.g. {{1}}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

/* ── web forms ──────────────────────────────────────────────────────────────────────────── */

function WebFormsSection() {
  const forms = useWebForms();
  const { create, update, remove } = useWebFormMutations();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<WebFormDto | null>(null);

  const rows = forms.data ?? [];

  return (
    <>
      <Panel
        title="Web forms"
        note="GET /web-forms · each form posts to its own URL and creates a lead"
        padded={false}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={Plus}
            onClick={() => {
              setCreateOpen(true);
            }}
          >
            New form
          </Button>
        }
      >
        {forms.isPending ? (
          <div className="p-3">
            <Skeleton height={120} shape="block" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            object="paper-plane"
            title="No web forms yet"
            description="Put a form on your site and enquiries arrive as leads."
            primaryAction={{
              label: 'New form',
              onClick: () => {
                setCreateOpen(true);
              },
            }}
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{f.name}</span>
                  <span className="mono block truncate text-sm text-faint">{f.submitUrl}</span>
                </span>
                <span className="mono text-sm text-muted">{f.submissionsCount} submissions</span>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={ClipboardCopy}
                  onClick={() => {
                    void navigator.clipboard.writeText(f.submitUrl);
                    toast({ tone: 'success', title: 'URL copied' });
                  }}
                >
                  Copy URL
                </Button>
                <Switch
                  checked={f.isActive}
                  ariaLabel={`${f.name} is active`}
                  onChange={(v) => {
                    update.mutate(
                      { id: f.id, body: { isActive: v } },
                      {
                        onError: (e) => {
                          toast({
                            tone: 'danger',
                            title: 'Could not update',
                            description: errorMessage(e),
                          });
                        },
                      },
                    );
                  }}
                />
                <IconButton
                  icon={Trash2}
                  label={`Delete ${f.name}`}
                  size={26}
                  variant="ghost"
                  onClick={() => {
                    setDeleting(f);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New web form"
        description="POST /web-forms · starts with name, phone and message"
        width={440}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCreateOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={create.isPending}
              disabled={name.trim() === ''}
              onClick={() => {
                create.mutate(
                  {
                    name: name.trim(),
                    defaultOwnerId: ownerId,
                    fields: [
                      { key: 'firstName', label: 'Name', type: 'text', required: true },
                      { key: 'phone', label: 'Phone', type: 'phone', required: true },
                      { key: 'notes', label: 'Message', type: 'textarea', required: false },
                    ],
                    allowedOrigins: [],
                  },
                  {
                    onSuccess: () => {
                      toast({ tone: 'success', title: 'Web form created' });
                      setCreateOpen(false);
                      setName('');
                    },
                    onError: (e) => {
                      toast({
                        tone: 'danger',
                        title: 'Could not create the form',
                        description: errorMessage(e),
                      });
                    },
                  },
                );
              }}
            >
              Create form
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            label="Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            description="Only you see this. It names the source on the leads it creates."
          />
          <OwnerPicker value={ownerId} onChange={setOwnerId} label="Assign new leads to" />
          <p className="text-sm text-faint">
            Allowed origins start empty, which accepts submissions from anywhere. Add your
            site&apos;s URL once you know it.
          </p>
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => {
          if (!v) setDeleting(null);
        }}
        title={deleting === null ? 'Delete form?' : `Delete ${deleting.name}?`}
        description="The submit URL stops working immediately. Leads it already created are kept."
        confirmLabel="Delete form"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (deleting === null) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast({ tone: 'success', title: 'Form deleted' });
              setDeleting(null);
            },
            onError: (e) => {
              toast({ tone: 'danger', title: 'Could not delete', description: errorMessage(e) });
            },
          });
        }}
      />
    </>
  );
}

/* ── users ──────────────────────────────────────────────────────────────────────────────── */

type UserRole = UserDto['role'];

/** What the user dialog hands back. Create needs the email; edit ignores it. */
interface UserDraft {
  name: string;
  email: string;
  role: UserRole;
  extension: string | null;
}

function UsersSection() {
  const perms = usePermissions();
  const query = useUsers({ pageSize: MAX_PAGE_SIZE });
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const action = useUserAction();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserDto | null>(null);

  const rows = query.data?.data ?? [];
  const canManage = perms.has('team:manage');

  const columns: Column<UserDto>[] = [
    {
      key: 'name',
      header: 'Name',
      width: '1.6fr',
      render: (u) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={u.name} seed={u.id} src={u.avatarUrl} size={20} />
          <span className="truncate font-medium">{u.name}</span>
        </span>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      width: '1.6fr',
      render: (u) => <span className="truncate text-muted">{u.email}</span>,
    },
    {
      key: 'role',
      header: 'Role',
      width: '0.8fr',
      render: (u) => <Badge tone="neutral">{u.role}</Badge>,
    },
    {
      key: 'extension',
      header: 'Extension',
      width: '0.8fr',
      render: (u) =>
        u.extension === null ? (
          <span className="text-faint">None</span>
        ) : (
          <span className="mono text-muted">{u.extension}</span>
        ),
    },
    {
      key: 'twoFactor',
      header: '2FA',
      width: '0.6fr',
      hideable: true,
      render: (u) =>
        u.twoFactorEnabled ? (
          <Check size={13} className="text-success" />
        ) : (
          <span className="text-faint">Off</span>
        ),
    },
    {
      key: 'isActive',
      header: 'Active',
      width: '0.6fr',
      render: (u) => (
        <Badge tone={u.isActive ? 'success' : 'neutral'}>{u.isActive ? 'Yes' : 'No'}</Badge>
      ),
    },
  ];

  return (
    <>
      <Panel
        title="Users"
        note="GET /users · roles decide what each person can do"
        padded={false}
        actions={
          canManage ? (
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={() => {
                setCreateOpen(true);
              }}
            >
              New user
            </Button>
          ) : undefined
        }
      >
        <DataTable
          tableId="settings-users"
          ariaLabel="Users"
          columns={columns}
          rows={rows}
          rowKey={(u) => u.id}
          state={
            query.isPending
              ? 'loading'
              : query.isError
                ? 'error'
                : rows.length === 0
                  ? 'empty'
                  : 'ready'
          }
          onRetry={() => {
            void query.refetch();
          }}
          onRowClick={
            canManage
              ? (u) => {
                  setEditing(u);
                }
              : undefined
          }
          rowActions={
            canManage
              ? (u) => [
                  {
                    id: 'toggle',
                    label: u.isActive ? 'Deactivate' : 'Reactivate',
                    danger: u.isActive,
                    onSelect: () => {
                      action.mutate(
                        { id: u.id, action: u.isActive ? 'deactivate' : 'reactivate' },
                        {
                          onSuccess: () => {
                            toast({
                              tone: 'success',
                              title: u.isActive ? 'User deactivated' : 'User reactivated',
                            });
                          },
                          onError: (e) => {
                            toast({
                              tone: 'danger',
                              title: 'Could not update the user',
                              description: errorMessage(e),
                            });
                          },
                        },
                      );
                    },
                  },
                ]
              : undefined
          }
          emptyState={{
            object: 'contact-card',
            title: 'No users',
            description: 'Invite the rest of the team.',
          }}
        />
      </Panel>

      <UserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        pending={createUser.isPending}
        onSubmit={(body) => {
          createUser.mutate(body, {
            onSuccess: () => {
              toast({
                tone: 'success',
                title: 'User created',
                description: 'They will get an email to set a password.',
              });
              setCreateOpen(false);
            },
            onError: (e) => {
              toast({
                tone: 'danger',
                title: 'Could not create the user',
                description: errorMessage(e),
              });
            },
          });
        }}
      />

      <UserDialog
        open={editing !== null}
        onOpenChange={(v) => {
          if (!v) setEditing(null);
        }}
        user={editing ?? undefined}
        pending={updateUser.isPending}
        onSubmit={(body) => {
          if (editing === null) return;
          const target = editing;
          const roleChanged = body.role !== target.role;
          updateUser.mutate(
            { id: target.id, body: { name: body.name, extension: body.extension } },
            {
              onSuccess: () => {
                if (!roleChanged) {
                  toast({ tone: 'success', title: 'User saved' });
                  setEditing(null);
                  return;
                }
                action.mutate(
                  { id: target.id, action: 'role', body: { role: body.role } },
                  {
                    onSuccess: () => {
                      toast({
                        tone: 'success',
                        title: 'User saved',
                        description: `Role changed to ${body.role}. Their other sessions were signed out.`,
                      });
                      setEditing(null);
                    },
                    onError: (e) => {
                      toast({
                        tone: 'danger',
                        title: 'Name saved, but the role did not change',
                        description: errorMessage(e),
                      });
                    },
                  },
                );
              },
              onError: (e) => {
                toast({
                  tone: 'danger',
                  title: 'Could not save the user',
                  description: errorMessage(e),
                });
              },
            },
          );
        }}
      />
    </>
  );
}

function UserDialog({
  open,
  onOpenChange,
  user,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user?: UserDto;
  pending: boolean;
  onSubmit: (body: UserDraft) => void;
}) {
  const editing = user !== undefined;
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState<UserRole>(user?.role ?? 'agent');
  const [extension, setExtension] = useState(user?.extension ?? '');

  useResetOnOpen(open, user, () => {
    setName(user?.name ?? '');
    setEmail(user?.email ?? '');
    setRole(user?.role ?? 'agent');
    setExtension(user?.extension ?? '');
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Edit user' : 'New user'}
      description={editing ? 'PATCH /users/:id' : 'POST /users'}
      width={440}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={name.trim() === '' || (!editing && email.trim() === '')}
            onClick={() => {
              onSubmit({
                name: name.trim(),
                email: email.trim(),
                role,
                extension: extension.trim() === '' ? null : extension.trim(),
              });
            }}
          >
            {editing ? 'Save' : 'Create user'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          autoFocus
          label="Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <Input
          label="Email"
          type="email"
          disabled={editing}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
          description={
            editing
              ? 'The email cannot be changed here.'
              : 'They will get a link to set their password.'
          }
        />
        <Select
          label="Role"
          value={role}
          onChange={(v) => {
            setRole(v as UserRole);
          }}
          options={[
            { value: 'agent', label: 'Agent', description: 'Handles calls and their own records' },
            {
              value: 'manager',
              label: 'Manager',
              description: 'Sees the team and the team reports',
            },
            { value: 'admin', label: 'Admin', description: 'Everything, including these settings' },
          ]}
        />
        <Input
          label="PBX extension"
          mono
          value={extension}
          onChange={(e) => {
            setExtension(e.target.value);
          }}
          description="Without an extension they cannot dial or receive screen pops."
        />
      </div>
    </Dialog>
  );
}

/* ── audit ──────────────────────────────────────────────────────────────────────────────── */

function AuditSection() {
  const list = useListState<AuditFilters>();
  const [entityId] = useSearchParam('entityId');
  const filters = useMemo(
    () => ({ ...list.queryParams, ...(entityId !== undefined ? { entityId } : {}) }),
    [list.queryParams, entityId],
  );
  const query = useAuditLog(filters);
  const [inspecting, setInspecting] = useState<{ before: unknown; after: unknown } | null>(null);

  const rows = query.data?.data ?? [];

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'createdAt',
      header: 'When',
      width: '1.1fr',
      render: (r) => (
        <span className="text-muted">
          <DateTime value={r.createdAt} />
        </span>
      ),
    },
    {
      key: 'actor',
      header: 'Who',
      width: '1.2fr',
      render: (r) =>
        r.actor === null ? (
          <span className="text-faint">{r.actorType}</span>
        ) : (
          <span className="truncate">{r.actor.name}</span>
        ),
    },
    {
      key: 'action',
      header: 'Action',
      width: '1.4fr',
      render: (r) => <span className="mono truncate">{r.action}</span>,
    },
    {
      key: 'entity',
      header: 'Entity',
      width: '0.9fr',
      render: (r) => <span className="text-muted">{r.entity}</span>,
    },
    {
      key: 'entityId',
      header: 'Record',
      width: '1fr',
      hideable: true,
      render: (r) =>
        r.entityId === null ? (
          <span className="text-faint">—</span>
        ) : (
          <Identifier value={r.entityId} />
        ),
    },
    {
      key: 'ip',
      header: 'IP',
      width: '1fr',
      hideable: true,
      optional: true,
      render: (r) => <span className="mono text-muted">{r.ip ?? '—'}</span>,
    },
    {
      key: 'requestId',
      header: 'Request',
      width: '1fr',
      hideable: true,
      optional: true,
      render: (r) =>
        r.requestId === null ? (
          <span className="text-faint">—</span>
        ) : (
          <Identifier value={r.requestId} />
        ),
    },
  ];

  return (
    <>
      <Panel title="Audit log" note="GET /audit · append only, and never edited" padded={false}>
        <DataTable
          tableId="audit"
          ariaLabel="Audit log"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          state={
            query.isPending
              ? 'loading'
              : query.isError
                ? 'error'
                : rows.length === 0
                  ? 'empty'
                  : 'ready'
          }
          pagination={{
            kind: 'offset',
            page: list.page,
            pageSize: list.pageSize,
            total: query.data?.page.total ?? 0,
          }}
          onPageChange={list.setPage}
          onPageSizeChange={list.setPageSize}
          onRetry={() => {
            void query.refetch();
          }}
          onRowClick={(r) => {
            setInspecting({ before: r.before, after: r.after });
          }}
          emptyState={{
            object: 'shield',
            title:
              entityId === undefined ? 'Nothing recorded yet' : 'Nothing recorded for this record',
            description: 'Every privileged action is written here as it happens.',
          }}
        />
      </Panel>

      <Dialog
        open={inspecting !== null}
        onOpenChange={(v) => {
          if (!v) setInspecting(null);
        }}
        title="What changed"
        width={640}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <h4 className="mb-1.5 text-sm font-medium text-muted">Before</h4>
            <pre className="mono max-h-80 overflow-auto rounded-sm border border-border bg-bg p-2 text-xs">
              {JSON.stringify(inspecting?.before ?? null, null, 2)}
            </pre>
          </div>
          <div>
            <h4 className="mb-1.5 text-sm font-medium text-muted">After</h4>
            <pre className="mono max-h-80 overflow-auto rounded-sm border border-border bg-bg p-2 text-xs">
              {JSON.stringify(inspecting?.after ?? null, null, 2)}
            </pre>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/* ── health ─────────────────────────────────────────────────────────────────────────────── */

function HealthSection() {
  const query = useSystemHealth();

  return (
    <Panel title="System health" note="GET /ready · refreshed every 30 seconds">
      {query.isPending ? (
        <Skeleton height={140} shape="block" />
      ) : query.isError ? (
        <ErrorState
          message={errorMessage(query.error)}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Badge tone={query.data.status === 'ready' ? 'success' : 'danger'}>
              {query.data.status === 'ready' ? 'Healthy' : 'Degraded'}
            </Badge>
            <span className="mono text-sm text-muted">{query.data.status}</span>
          </div>
          {query.data.checks === undefined ? (
            <p className="text-base text-muted">
              Signed in without the internal detail view; only the overall status is shown.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-sm border border-border">
              {Object.entries(query.data.checks).map(([name, check]) => (
                <li key={name} className="flex items-center gap-3 px-3 py-2">
                  <span className="mono min-w-0 flex-1 truncate text-sm">{name}</span>
                  <Badge tone={check.ok ? 'success' : 'danger'}>
                    {check.ok ? 'OK' : 'Failing'}
                  </Badge>
                  {check.detail !== undefined && (
                    <span className="mono max-w-64 truncate text-xs text-faint">
                      {JSON.stringify(check.detail)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

/** Local reset helper: the user dialog is reused for create and edit, keyed by the user it edits. */
function useResetOnOpen(open: boolean, user: UserDto | undefined, reset: () => void): void {
  const [seen, setSeen] = useState<string | null>(null);
  const key = open ? (user?.id ?? 'new') : null;
  if (seen !== key) {
    setSeen(key);
    if (key !== null) reset();
  }
}

/* -- backups ----------------------------------------------------------------------------- */

/**
 * The application does not take snapshots and does not restore them. Taking one is a command, and
 * the backup container is where commands belong; restoring replaces the database under a running
 * system, which is an operator job with the stack stopped. What belongs here is getting a snapshot
 * out, and getting one in from another server.
 */
function BackupsSection() {
  const list = useBackups();
  const { upload, remove } = useBackupMutations();
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState<BackupDto | null>(null);
  const rows = list.data?.data ?? [];

  return (
    <SectionShell
      title="Backups"
      description="Snapshots taken nightly by the backup service and kept on this server."
      loading={list.isPending}
      error={list.error}
      onRetry={() => {
        void list.refetch();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept=".dump,application/octet-stream"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            upload.mutate(file, {
              onSuccess: () => {
                toast({ tone: 'success', title: 'Backup uploaded' });
              },
              onError: (err) => {
                toast({
                  tone: 'danger',
                  title: 'Could not upload',
                  description: errorMessage(err),
                });
              },
            });
          }}
        />
        <Button
          variant="secondary"
          icon={Upload}
          loading={upload.isPending}
          onClick={() => fileInput.current?.click()}
        >
          Upload a backup
        </Button>
      </div>

      <p className="mt-3 text-sm text-muted">
        Each file is a <span className="mono">pg_dump</span> archive. To put one back, an
        administrator restores it with the stack stopped; the application will not overwrite a live
        database from this page.
      </p>

      {rows.length === 0 ? (
        <EmptyState
          compact
          className="mt-4"
          object="folder"
          title="No backups yet"
          description="The backup service writes one every night. The first appears after its next run."
        />
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {rows.map((b) => (
            <li
              key={b.key}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-border bg-surface p-3"
            >
              <span className="mono min-w-0 flex-1 truncate text-sm">{b.fileName}</span>
              {b.origin === 'uploaded' && <Badge tone="neutral">Uploaded</Badge>}
              <span className="text-sm text-muted">{formatBytes(b.sizeBytes)}</span>
              <span className="text-sm text-muted">
                <DateTime value={b.createdAt} />
              </span>
              <a
                href={`/api/v1/backups/download?key=${encodeURIComponent(b.key)}`}
                className="text-sm underline underline-offset-2"
              >
                Download
              </a>
              <IconButton
                icon={Trash2}
                size={26}
                variant="ghost"
                label={`Delete ${b.fileName}`}
                onClick={() => {
                  setConfirming(b);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(v) => {
          if (!v) setConfirming(null);
        }}
        title="Delete this backup?"
        description="The archive is removed from the server. This cannot be undone."
        confirmLabel="Delete backup"
        tone="danger"
        onConfirm={() => {
          const target = confirming;
          setConfirming(null);
          if (target)
            remove.mutate(target.key, {
              onError: (e) => {
                toast({ tone: 'danger', title: 'Could not delete', description: errorMessage(e) });
              },
            });
        }}
      />
    </SectionShell>
  );
}
