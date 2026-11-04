/**
 * Sets the CRM's calls against the phone system's own records for the range on screen. A report
 * people can check is a report they stop arguing with. Checks only on request, because it reads
 * the phone system live.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { errorMessage } from '@/lib/api/errors';
import { http } from '@/lib/api/client';
import { formatDuration } from '@/lib/format';
import { qk } from '@/lib/query';
import { usePermissions } from '@/providers/permissions';

interface Tally {
  checkedAt: string;
  phoneSystemRows: number;
  phoneSystemCalls: number;
  crmCalls: number;
  phoneSystemTalkSec: number;
  crmTalkSec: number;
  lines: {
    direction: 'inbound' | 'outbound' | 'internal';
    outcome: 'answered' | 'not_answered';
    phoneSystem: number;
    crm: number;
  }[];
  missingFromCrm: number;
  onlyInCrm: number;
  differing: number;
  complete: boolean;
  agrees: boolean;
}

const DIRECTION = { inbound: 'Inbound', outbound: 'Outbound', internal: 'Internal' };
const OUTCOME = { answered: 'answered', not_answered: 'not answered' };

export function TallyPanel({ filters }: { filters: { from: string; to: string } }) {
  const perms = usePermissions();
  const qc = useQueryClient();
  const [asked, setAsked] = useState<string | null>(null);
  const key = `${filters.from}|${filters.to}`;
  const query = useQuery({
    queryKey: ['reports', 'tally', filters.from, filters.to],
    queryFn: () => http.get<Tally>('/api/v1/reports/calls/tally', filters),
    enabled: asked === key,
    staleTime: 60_000,
    retry: false,
  });
  const repair = useMutation({
    mutationFn: () => http.post('/api/v1/cti/reconcile', { since: filters.from }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports'] });
      void qc.invalidateQueries({ queryKey: qk.list('calls') });
    },
  });
  if (!perms.has('report:view_team')) return null;
  const tally = query.data;
  const needsRepair = tally !== undefined && (tally.missingFromCrm > 0 || tally.differing > 0);

  return (
    <section className="rounded-md border border-border bg-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-medium">Checked against the phone system</h3>
          <p className="text-sm text-muted">
            {tally === undefined
              ? 'Compare these numbers with the phone system’s own records for the same dates.'
              : tally.agrees
                ? `Agrees: ${String(tally.crmCalls)} calls on both sides.`
                : 'The two sides differ. The details are below.'}
          </p>
        </div>
        <Button
          variant="secondary"
          loading={query.isFetching}
          onClick={() => {
            if (asked === key) void query.refetch();
            else setAsked(key);
          }}
        >
          {tally === undefined ? 'Check now' : 'Check again'}
        </Button>
      </div>

      {query.isError && (
        <p role="alert" className="mt-3 text-sm text-danger">
          Could not read the phone system: {errorMessage(query.error)}
        </p>
      )}

      {tally !== undefined && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1 pr-4 font-medium">Calls</th>
                  <th className="py-1 pr-4 text-right font-medium">Phone system</th>
                  <th className="py-1 pr-4 text-right font-medium">CRM</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {tally.lines
                  .filter((l) => l.phoneSystem > 0 || l.crm > 0)
                  .map((l) => (
                    <tr key={`${l.direction}-${l.outcome}`} className="border-t border-border">
                      <td className="py-1 pr-4">
                        {DIRECTION[l.direction]}, {OUTCOME[l.outcome]}
                      </td>
                      <td className="py-1 pr-4 text-right">{l.phoneSystem}</td>
                      <td className="py-1 pr-4 text-right">{l.crm}</td>
                    </tr>
                  ))}
                <tr className="border-t border-border font-medium">
                  <td className="py-1 pr-4">Total calls</td>
                  <td className="py-1 pr-4 text-right">{tally.phoneSystemCalls}</td>
                  <td className="py-1 pr-4 text-right">{tally.crmCalls}</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="py-1 pr-4">Talk time</td>
                  <td className="py-1 pr-4 text-right">
                    {formatDuration(tally.phoneSystemTalkSec)}
                  </td>
                  <td className="py-1 pr-4 text-right">{formatDuration(tally.crmTalkSec)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {tally.phoneSystemRows !== tally.phoneSystemCalls && (
            <p className="text-sm text-muted">
              The phone system’s call list shows {tally.phoneSystemRows} rows for these{' '}
              {tally.phoneSystemCalls} calls, because it lists an answered queue call twice: once as
              the queue and once as the agent. The CRM counts each call once.
            </p>
          )}
          {!tally.complete && (
            <p className="text-sm text-warning">
              This range is too large to check in full. Choose fewer days.
            </p>
          )}
          {tally.onlyInCrm > 0 && (
            <p className="text-sm text-muted">
              {tally.onlyInCrm} calls in the CRM start just inside these dates but are filed just
              outside them on the phone system.
            </p>
          )}
          {needsRepair && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-warning">
                {tally.missingFromCrm} missing from the CRM, {tally.differing} recorded differently.
              </p>
              <Button
                variant="secondary"
                loading={repair.isPending}
                onClick={() => {
                  repair.mutate(undefined, {
                    onSuccess: () => {
                      void query.refetch();
                    },
                  });
                }}
              >
                Bring the CRM in line
              </Button>
              {repair.isError && (
                <span role="alert" className="text-sm text-danger">
                  {errorMessage(repair.error)}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
