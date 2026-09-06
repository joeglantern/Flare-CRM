/**
 * DuplicateCompare and MergeDialog (Contacts · Duplicates + merge).
 *
 * GAP-02: the merge endpoint takes `sourceId` only and the target always wins on conflict. So
 * "keep this value" is a pre-edit of the target: the UI PATCHes the target with the chosen fields,
 * then calls merge. The dialog says exactly that, rather than implying one atomic operation.
 */
import type { ContactDto, ContactSummaryDto } from '@crm/shared';
import { ArrowLeftRight, Copy, Merge, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Overlay';
import { Skeleton } from '@/components/ui/Loading';
import { toast } from '@/components/ui/toast';
import { EmptyState } from '@/components/data/states';
import { Panel } from '@/components/entity/EntityHeader';
import { formatPhone } from '@/lib/format';
import { errorMessage } from '@/lib/api/errors';
import { cn } from '@/lib/utils';
import { useContact, useContactMutations, useDuplicates } from './api';

interface CompareField {
  key: string;
  label: string;
  target: string;
  source: string;
  /** Only fields the PATCH body accepts can be moved across before the merge. */
  patchable: boolean;
}

export function DuplicatesPanel({ contact }: { contact: ContactDto }) {
  const primaryPhone = contact.phones.find((p) => p.isPrimary) ?? contact.phones[0];
  const primaryEmail = contact.emails.find((e) => e.isPrimary) ?? contact.emails[0];
  const duplicates = useDuplicates({
    ...(primaryPhone !== undefined ? { phone: primaryPhone.e164 } : {}),
    ...(primaryEmail !== undefined ? { email: primaryEmail.email } : {}),
  });
  const [merging, setMerging] = useState<ContactSummaryDto | null>(null);

  const others = (duplicates.data ?? []).filter((d) => d.contact.id !== contact.id);

  return (
    <Panel
      title="Possible duplicates"
      note="GET /contacts/duplicates?phone=&email= · matched on phone or email"
      padded={false}
    >
      {duplicates.isPending && (
        <div className="p-3">
          <Skeleton count={2} height={48} shape="block" className="mb-2" />
        </div>
      )}
      {!duplicates.isPending && others.length === 0 && (
        <EmptyState
          compact
          object="chain"
          title="No duplicates found"
          description="Nobody else shares this contact's phone number or email address."
        />
      )}
      <ul>
        {others.map((d) => (
          <li
            key={d.contact.id}
            className="flex items-center gap-3 border-b border-border px-3.5 py-2.5 last:border-b-0"
          >
            <Avatar
              name={d.contact.displayName}
              seed={d.contact.id}
              src={d.contact.avatarUrl}
              size={24}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{d.contact.displayName}</span>
              <span className="block truncate text-sm text-muted">
                {d.contact.company?.name ?? 'No company'}
              </span>
            </span>
            <Badge tone="warning" icon={Copy}>
              Same {d.matchedOn}
            </Badge>
            <span className="mono hidden shrink-0 text-sm text-muted sm:block">
              {d.matchedOn === 'phone' ? formatPhone(d.value) : d.value}
            </span>
            <Button
              size="sm"
              variant="secondary"
              icon={ArrowLeftRight}
              onClick={() => {
                setMerging(d.contact);
              }}
            >
              Compare
            </Button>
          </li>
        ))}
      </ul>

      {merging !== null && (
        <MergeDialog
          target={contact}
          sourceId={merging.id}
          onClose={() => {
            setMerging(null);
          }}
        />
      )}
    </Panel>
  );
}

export function MergeDialog({
  target,
  sourceId,
  onClose,
}: {
  target: ContactDto;
  sourceId: string;
  onClose: () => void;
}) {
  const source = useContact(sourceId);
  const { merge, update } = useContactMutations();
  const [keep, setKeep] = useState<Record<string, 'target' | 'source'>>({});
  const [done, setDone] = useState<ContactDto | null>(null);

  const fields = useMemo<CompareField[]>(() => {
    const s = source.data;
    if (s === undefined) return [];
    const phones = (c: ContactDto) =>
      c.phones.map((p) => `${p.display} (${p.type})`).join(', ') || '—';
    const emails = (c: ContactDto) => c.emails.map((e) => e.email).join(', ') || '—';
    return [
      {
        key: 'name',
        label: 'Name',
        target: target.displayName,
        source: s.displayName,
        patchable: true,
      },
      {
        key: 'phones',
        label: 'Phones',
        target: phones(target),
        source: phones(s),
        patchable: false,
      },
      {
        key: 'emails',
        label: 'Emails',
        target: emails(target),
        source: emails(s),
        patchable: false,
      },
      {
        key: 'companyId',
        label: 'Company',
        target: target.company?.name ?? '—',
        source: s.company?.name ?? '—',
        patchable: true,
      },
      {
        key: 'ownerId',
        label: 'Owner',
        target: target.owner?.name ?? 'Unassigned',
        source: s.owner?.name ?? 'Unassigned',
        patchable: true,
      },
      {
        key: 'jobTitle',
        label: 'Job title',
        target: target.jobTitle ?? '—',
        source: s.jobTitle ?? '—',
        patchable: true,
      },
      {
        key: 'tags',
        label: 'Tags',
        target: target.tags.join(', ') || '—',
        source: s.tags.join(', ') || '—',
        patchable: true,
      },
      { key: 'source', label: 'Source', target: target.source, source: s.source, patchable: false },
    ];
  }, [source.data, target]);

  const changes = Object.entries(keep).filter(([, v]) => v === 'source');

  const run = () => {
    const s = source.data;
    if (s === undefined) return;
    const patch: Record<string, unknown> = {};
    for (const [key] of changes) {
      if (key === 'name') {
        patch.firstName = s.firstName;
        patch.lastName = s.lastName;
      } else if (key === 'companyId') patch.companyId = s.companyId;
      else if (key === 'ownerId') patch.ownerId = s.ownerId;
      else if (key === 'jobTitle') patch.jobTitle = s.jobTitle;
      else if (key === 'tags') patch.tags = [...new Set([...target.tags, ...s.tags])];
    }

    const doMerge = () => {
      merge.mutate(
        { targetId: target.id, sourceId },
        {
          onSuccess: (c) => {
            setDone(c);
            toast({ tone: 'success', title: 'Contacts merged' });
          },
          onError: (e) => {
            toast({ tone: 'danger', title: 'Merge failed', description: errorMessage(e) });
          },
        },
      );
    };

    if (Object.keys(patch).length > 0) {
      update.mutate(
        { id: target.id, body: patch },
        {
          onSuccess: doMerge,
          onError: (e) => {
            toast({
              tone: 'danger',
              title: 'Could not apply your field choices',
              description: errorMessage(e),
            });
          },
        },
      );
    } else {
      doMerge();
    }
  };

  const busy = merge.isPending || update.isPending;

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
      title={done !== null ? 'Contacts merged' : 'Merge duplicate contacts'}
      width={720}
      dismissable={!busy}
      footer={
        done !== null ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" icon={Merge} loading={busy} onClick={run}>
              Merge into {target.displayName}
            </Button>
          </>
        )
      }
    >
      {done !== null ? (
        <div className="flex flex-col gap-3 text-base">
          <p>
            <strong>{done.displayName}</strong> now holds both records. The duplicate was soft
            deleted and its phones, emails, calls, notes, tasks and deals moved across.
          </p>
          <p className="text-muted">
            You can still restore the duplicate from its own page until the retention purge.
          </p>
        </div>
      ) : source.isPending ? (
        <Skeleton count={6} height={32} shape="block" className="mb-2" />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="flex items-start gap-2 rounded-md bg-[var(--warning-subtle)] p-3 text-sm">
            <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden />
            <span>
              The API merges into the record you are viewing and the target always wins on a
              conflict. Choosing a value from the duplicate edits this contact first, then merges —
              two audited steps, not one.
            </span>
          </p>

          <div className="grid grid-cols-[minmax(0,120px)_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 text-base">
            <span />
            <span className="truncate border-b border-border pb-2 font-medium">
              {target.displayName} <span className="text-sm text-muted">(kept)</span>
            </span>
            <span className="truncate border-b border-border pb-2 font-medium">
              {source.data?.displayName} <span className="text-sm text-muted">(merged away)</span>
            </span>

            {fields.map((f) => {
              const choice = keep[f.key] ?? 'target';
              return (
                <div key={f.key} className="contents">
                  <span className="truncate border-b border-border py-2 text-sm text-muted">
                    {f.label}
                  </span>
                  <button
                    type="button"
                    disabled={!f.patchable}
                    onClick={() => {
                      setKeep((k) => ({ ...k, [f.key]: 'target' }));
                    }}
                    className={cn(
                      'min-w-0 truncate border-b border-border px-2 py-2 text-left',
                      choice === 'target' ? 'bg-[var(--flare-subtle)] text-text' : 'text-faint',
                      !f.patchable && 'cursor-default',
                    )}
                  >
                    {f.target}
                  </button>
                  <button
                    type="button"
                    disabled={!f.patchable}
                    title={
                      f.patchable
                        ? undefined
                        : 'Merged automatically; not editable before the merge'
                    }
                    onClick={() => {
                      setKeep((k) => ({ ...k, [f.key]: 'source' }));
                    }}
                    className={cn(
                      'min-w-0 truncate border-b border-border px-2 py-2 text-left',
                      choice === 'source' ? 'bg-[var(--flare-subtle)] text-text' : 'text-faint',
                      !f.patchable && 'cursor-default',
                    )}
                  >
                    {f.source}
                  </button>
                </div>
              );
            })}
          </div>

          <p className="mono text-xs text-faint">
            {changes.length > 0 ? 'PATCH /contacts/:id then ' : ''}POST /contacts/
            {target.id.slice(0, 8)}…/merge {'{'} sourceId {'}'}
          </p>
        </div>
      )}
    </Dialog>
  );
}
