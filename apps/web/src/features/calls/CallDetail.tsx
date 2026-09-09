/**
 * Call detail (Calls · Detail): who, when, how long, the recording player, the disposition
 * and the routing trail from the PBX.
 *
 * GAP-12: recording playback is audited but the play history is not on the DTO, so this links to
 * the filtered audit log rather than showing a list it cannot fill.
 * An unmatched call offers to link a contact, which is the only way the call joins a timeline.
 */
import { Link } from '@tanstack/react-router';
import { Link2, ScrollText, SquareCheck, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/Loading';
import { Dialog } from '@/components/ui/Overlay';
import { toast } from '@/components/ui/toast';
import { DateTime, Duration, Identifier } from '@/components/data/formatters';
import { PhoneNumber } from '@/components/data/PhoneNumber';
import { CallDirection, CallStatusBadge, RecordingBadge } from '@/components/data/status';
import { ErrorState, ForbiddenState, NotFoundState } from '@/components/data/states';
import { DetailList, EntityHeader, Panel } from '@/components/entity/EntityHeader';
import { NotesPanel } from '@/components/entity/Notes';
import { ContactPicker } from '@/components/entity/pickers';
import { usePageMeta } from '@/app/shell/page-meta';
import { DispositionForm } from '@/features/telephony/DispositionForm';
import { useLinkCallContact } from '@/features/telephony/api';
import { TaskFormDialog } from '@/features/tasks/TaskForm';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { linkTo } from '@/lib/links';
import { usePermissions } from '@/providers/permissions';
import { recordingUrl, useCall, useDeleteRecording, useRecordingHistory } from './api';

export function CallDetailScreen({ callId }: { callId: string }) {
  const perms = usePermissions();
  const query = useCall(callId);
  const call = query.data;
  const link = useLinkCallContact();
  const deleteRecording = useDeleteRecording();
  const canListen =
    call !== undefined && perms.has('call:listen_recording') && call.recordingStatus === 'stored';
  const history = useRecordingHistory(call?.id ?? null, canListen);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);
  const [confirmDeleteRecording, setConfirmDeleteRecording] = useState(false);

  usePageMeta([{ label: 'Calls', href: '/calls' }, { label: 'Call' }]);

  if (query.isError) {
    if (isApiError(query.error) && query.error.status === 404) {
      return <NotFoundState what="call" backTo={{ label: 'All calls', href: '/calls' }} />;
    }
    if (isApiError(query.error) && query.error.isForbidden) {
      return (
        <ForbiddenState
          permission="call:read"
          what="this call"
          backTo={{ label: 'All calls', href: '/calls' }}
        />
      );
    }
    return (
      <div className="p-6">
        <ErrorState
          message={errorMessage(query.error)}
          requestId={isApiError(query.error) ? query.error.requestId : null}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </div>
    );
  }

  if (query.isPending || call === undefined) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton height={56} shape="block" />
        <Skeleton height={200} shape="block" />
      </div>
    );
  }

  const who =
    call.contact?.displayName ?? call.externalDisplay ?? call.externalNumber ?? 'Unknown number';
  const unmatched = call.contactId === null;
  const canDeleteRecording =
    perms.has('call:delete_recording') && call.recordingStatus === 'stored';

  return (
    <div className="flex flex-col gap-4 p-6">
      <EntityHeader
        title={who}
        avatarSeed={call.contactId ?? call.id}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
            <span className="flex items-center gap-1.5">
              <CallDirection direction={call.direction} />
              {call.direction === 'inbound' ? 'Inbound' : 'Outbound'}
            </span>
            <DateTime value={call.startedAt} />
            <span>
              Talk <Duration seconds={call.talkDurationSec} format="long" />
            </span>
          </span>
        }
        badges={
          <>
            <CallStatusBadge status={call.status} />
            {call.recordingStatus === 'stored' && <RecordingBadge />}
          </>
        }
        {...(call.externalNumber !== null
          ? {
              phone: {
                e164: call.externalNumber,
                contactId: call.contactId,
                ...(call.contact !== null ? { contactName: call.contact.displayName } : {}),
                actions: true,
              },
            }
          : {})}
        actions={[
          ...(perms.has('task:create')
            ? [
                {
                  id: 'task',
                  label: 'New task',
                  icon: SquareCheck,
                  variant: 'secondary' as const,
                  onClick: () => {
                    setTaskOpen(true);
                  },
                },
              ]
            : []),
          ...(unmatched && perms.has('contact:update')
            ? [
                {
                  id: 'link',
                  label: 'Link a contact',
                  icon: Link2,
                  variant: 'primary' as const,
                  onClick: () => {
                    setLinkOpen(true);
                  },
                },
              ]
            : []),
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-3">
          {canListen ? (
            <Panel title="Recording" note="Every play is written to the audit log with your name.">
              <div className="flex flex-col gap-3">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a phone recording has no caption track */}
                <audio controls preload="none" src={recordingUrl(call.id)} className="w-full">
                  Your browser cannot play this recording.
                </audio>

                {history.data !== undefined && history.data.length > 0 && (
                  <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-muted">
                      <ScrollText size={13} aria-hidden />
                      Who listened
                    </span>
                    <ul className="flex flex-col gap-1">
                      {history.data.map((h, i) => (
                        <li
                          // one call can be played more than once by the same person, so there is
                          // no natural unique key beyond position in this already time-ordered list
                          key={i}
                          className="flex items-center gap-2 text-sm text-muted"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {h.actor?.name ?? 'Someone no longer on the team'}
                          </span>
                          <DateTime value={h.at} mode="relative" />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  {canDeleteRecording && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      className="ml-auto"
                      onClick={() => {
                        setConfirmDeleteRecording(true);
                      }}
                    >
                      Delete recording
                    </Button>
                  )}
                </div>
              </div>
            </Panel>
          ) : (
            <Panel title="Recording">
              <p className="text-base text-muted">
                {call.recordingStatus === 'stored'
                  ? 'You do not have permission to listen to recordings.'
                  : call.recordingStatus === 'pending'
                    ? 'The recording has not arrived from the PBX yet.'
                    : call.recordingStatus === 'failed'
                      ? 'The PBX reported that this recording could not be fetched.'
                      : 'This call was not recorded.'}
              </p>
            </Panel>
          )}

          <Panel title="Disposition">
            {perms.has('call:set_disposition') ? (
              <DispositionForm
                callId={call.id}
                contactId={call.contactId}
                compact={false}
                initial={{
                  dispositionId: call.disposition?.id ?? null,
                  note: call.dispositionNote ?? '',
                }}
                onDone={() => {
                  void query.refetch();
                }}
              />
            ) : call.disposition === null ? (
              <p className="text-base text-muted">No disposition was set.</p>
            ) : (
              <DetailList
                items={[
                  { label: 'Outcome', value: call.disposition.name },
                  {
                    label: 'Note',
                    value: call.dispositionNote ?? <span className="text-faint">None</span>,
                  },
                ]}
              />
            )}
          </Panel>

          <Panel title="Notes on this call" note="POST /notes {callId}">
            <NotesPanel parent="call" id={call.id} canCreate={perms.has('note:create')} />
          </Panel>

          <Panel
            title="Routing"
            note="Straight from the PBX event, for when a call went somewhere unexpected."
          >
            <DetailList
              items={[
                { label: 'From', value: <span className="mono">{call.fromNumber}</span> },
                { label: 'To', value: <span className="mono">{call.toNumber}</span> },
                {
                  label: 'Trunk',
                  value: call.trunkName ?? <span className="text-faint">Not reported</span>,
                },
                {
                  label: 'DID',
                  value: call.didNumber ?? <span className="text-faint">Not reported</span>,
                },
                {
                  label: 'Extension',
                  value: call.extension ?? <span className="text-faint">None</span>,
                },
                {
                  label: 'Path',
                  value: call.callPath ?? <span className="text-faint">Not reported</span>,
                },
                { label: 'PBX call id', value: <Identifier value={call.pbxCallId} /> },
              ]}
            />
          </Panel>
        </div>

        <aside className="flex min-w-0 flex-col gap-3">
          <Panel title="Timing">
            <DetailList
              items={[
                { label: 'Started', value: <DateTime value={call.startedAt} /> },
                { label: 'Answered', value: <DateTime value={call.answeredAt} /> },
                { label: 'Ended', value: <DateTime value={call.endedAt} /> },
                { label: 'Ring', value: <Duration seconds={call.ringDurationSec} format="long" /> },
                { label: 'Talk', value: <Duration seconds={call.talkDurationSec} format="long" /> },
                {
                  label: 'Total',
                  value: <Duration seconds={call.totalDurationSec} format="long" />,
                },
              ]}
            />
          </Panel>

          <Panel title="People">
            <DetailList
              items={[
                {
                  label: 'Contact',
                  value:
                    call.contact === null ? (
                      <span className="flex flex-col items-start gap-1.5">
                        <span className="text-faint">Not matched</span>
                        {perms.has('contact:update') && (
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={Link2}
                            onClick={() => {
                              setLinkOpen(true);
                            }}
                          >
                            Link a contact
                          </Button>
                        )}
                      </span>
                    ) : (
                      <Link
                        {...linkTo.contact(call.contact.id)}
                        className="flex items-center gap-1.5 underline-offset-2 hover:underline"
                      >
                        <UserRound size={12} aria-hidden />
                        {call.contact.displayName}
                      </Link>
                    ),
                },
                {
                  label: 'Handled by',
                  value:
                    call.user === null ? (
                      <span className="text-faint">Nobody answered</span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Avatar name={call.user.name} seed={call.user.id} size={18} />
                        {call.user.name}
                      </span>
                    ),
                },
                {
                  label: 'Number',
                  value: (
                    <PhoneNumber e164={call.externalNumber} contactId={call.contactId} actions />
                  ),
                },
              ]}
            />
          </Panel>
        </aside>
      </div>

      <Dialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        title="Link this call to a contact"
        description="POST /calls/:id/contact"
        width={440}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setLinkOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={link.isPending}
              disabled={linkTarget === null}
              onClick={() => {
                if (linkTarget === null) return;
                link.mutate(
                  { callId: call.id, contactId: linkTarget },
                  {
                    onSuccess: () => {
                      toast({ tone: 'success', title: 'Call linked' });
                      setLinkOpen(false);
                      void query.refetch();
                    },
                    onError: (e) => {
                      toast({
                        tone: 'danger',
                        title: 'Could not link the call',
                        description: errorMessage(e),
                      });
                    },
                  },
                );
              }}
            >
              Link
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            The call joins that contact&apos;s timeline, and the number is remembered for next time.
          </p>
          <ContactPicker value={linkTarget} onChange={setLinkTarget} required />
        </div>
      </Dialog>

      <TaskFormDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        defaults={{
          sourceCallId: call.id,
          ...(call.contactId !== null ? { contactId: call.contactId } : {}),
          title: `Follow up with ${who}`,
        }}
      />

      <ConfirmDialog
        open={confirmDeleteRecording}
        onOpenChange={setConfirmDeleteRecording}
        title="Delete this recording?"
        description="The audio file is removed from storage. The call record itself stays."
        confirmLabel="Delete recording"
        consequences={[
          'This cannot be undone',
          'The deletion is written to the audit log with your name',
        ]}
        loading={deleteRecording.isPending}
        onConfirm={() => {
          deleteRecording.mutate(call.id, {
            onSuccess: () => {
              toast({ tone: 'success', title: 'Recording deleted' });
              setConfirmDeleteRecording(false);
            },
            onError: (e) => {
              toast({
                tone: 'danger',
                title: 'Could not delete the recording',
                description: errorMessage(e),
              });
            },
          });
        }}
      />
    </div>
  );
}
