/**
 * Telephony data access (docs/06). Everything the popup, dialer, calls list and live board need.
 */
import type { CallControlBody, DialBody, callDispositionDto } from '@crm/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { api, unwrap } from '@/lib/api/client';
import { qk } from '@/lib/query';

export type CallDispositionDto = z.infer<typeof callDispositionDto>;

export interface CtiCapabilities {
  enabled: boolean;
  answer: 'none' | 'api' | 'webrtc';
  decline: boolean;
  hangup: boolean;
  hold: boolean;
  mute: boolean;
  transfer: boolean;
  dial: boolean;
  myExtension: string | null;
}

export interface CtiStatus {
  enabled: boolean;
  connected: boolean;
  leader: string | null;
  since: string | null;
  lastEventAt: string | null;
  tokenExpiresAt: string | null;
  lastReconcileAt: string | null;
  eventSource: string;
  liveCalls: number;
}

export interface LiveCallDto {
  pbxCallId: string;
  callId: string | null;
  direction: 'inbound' | 'outbound' | 'internal';
  external: string | null;
  extension: string | null;
  userName: string | null;
  contactName: string | null;
  status: string;
  since: string;
}

export const capabilitiesQuery = queryOptions({
  queryKey: [...qk.cti(), 'capabilities'],
  queryFn: async (): Promise<CtiCapabilities> =>
    unwrap(await api.GET('/api/v1/cti/capabilities')).data,
  staleTime: 60_000,
});

export function useCapabilities(): CtiCapabilities {
  const { data } = useQuery(capabilitiesQuery);
  return (
    data ?? {
      enabled: false,
      answer: 'none',
      decline: false,
      hangup: false,
      hold: false,
      mute: false,
      transfer: false,
      dial: false,
      myExtension: null,
    }
  );
}

export function useCtiStatus(enabled = true) {
  return useQuery({
    queryKey: [...qk.cti(), 'status'],
    queryFn: async (): Promise<CtiStatus> => unwrap(await api.GET('/api/v1/cti/status')).data,
    refetchInterval: 30_000,
    enabled,
  });
}

export function useLiveCalls(enabled = true) {
  return useQuery({
    queryKey: [...qk.cti(), 'live-calls'],
    queryFn: async (): Promise<LiveCallDto[]> =>
      unwrap(await api.GET('/api/v1/cti/live-calls')).data as LiveCallDto[],
    refetchInterval: 15_000,
    enabled,
  });
}

export function useDispositions() {
  return useQuery({
    queryKey: ['call-dispositions'],
    queryFn: async (): Promise<CallDispositionDto[]> =>
      unwrap(await api.GET('/api/v1/call-dispositions')).data as CallDispositionDto[],
    staleTime: 5 * 60_000,
  });
}

export function useDial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: DialBody) =>
      unwrap(await api.POST('/api/v1/calls/dial', { body: body as never })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.list('calls') });
    },
  });
}

export function useCallControl(callId: string) {
  return useMutation({
    mutationFn: async (body: CallControlBody) =>
      unwrap(
        await api.POST('/api/v1/calls/{id}/control', {
          params: { path: { id: callId } },
          body: body as never,
        }),
      ),
  });
}

export function useSetDisposition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      callId,
      dispositionId,
      note,
    }: {
      callId: string;
      dispositionId: string | null;
      note?: string | null;
    }) =>
      unwrap(
        await api.PATCH('/api/v1/calls/{id}/disposition', {
          params: { path: { id: callId } },
          body: { dispositionId, ...(note !== undefined ? { note } : {}) } as never,
        }),
      ).data,
    onSuccess: (call) => {
      void qc.invalidateQueries({ queryKey: qk.list('calls') });
      void qc.invalidateQueries({ queryKey: qk.entity('call', call.id) });
      if (call.contactId !== null) {
        void qc.invalidateQueries({ queryKey: qk.timeline('contact', call.contactId) });
      }
    },
  });
}

export function useLinkCallContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ callId, contactId }: { callId: string; contactId: string }) =>
      unwrap(
        await api.POST('/api/v1/calls/{id}/link-contact', {
          params: { path: { id: callId } },
          body: { contactId } as never,
        }),
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.list('calls') });
    },
  });
}

/**
 * Turns an E.164 number into the literal string the PBX will dial, so the confirmation can show
 * it. Mirrors toDialable() in packages/shared; kept here because dial rules are admin-only
 * settings and the agent's client may not have them.
 */
export interface DialRules {
  stripPlus: boolean;
  outboundPrefix: string;
  e164ToDialable: 'national' | 'international';
}

export function previewDialable(
  e164: string,
  rules: DialRules | null,
  country = 'KE',
): string | null {
  if (rules === null) return null;
  let digits = e164;
  if (rules.e164ToDialable === 'national' && country === 'KE' && e164.startsWith('+254')) {
    digits = `0${e164.slice(4)}`;
  } else if (rules.stripPlus) {
    digits = e164.replace(/^\+/, '');
  }
  return `${rules.outboundPrefix}${digits}`;
}
