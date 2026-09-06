/**
 * Call popup state (docs/17 section 2). A stack of call cards driven only by socket events; the UI
 * renders the stack and never mutates it directly. Mirrors the backend machine:
 *   ringing -> answered -> ended -> logged (disposition form) -> closed
 *   cancelled removes the card (answered elsewhere, caller hung up, timeout)
 *   dialing is the outbound equivalent of ringing
 * Timers use server timestamps (answeredAt), never local clocks (docs/17 section 2).
 */
import type { ServerEventPayload } from '@crm/shared';
import { create } from 'zustand';

export type RingingPayload = ServerEventPayload<'call:ringing'>;
export type LoggedPayload = ServerEventPayload<'call:logged'>;
export type CancelReason = ServerEventPayload<'call:cancelled'>['reason'];

export type CallCardStatus = 'ringing' | 'dialing' | 'answered' | 'ended' | 'logged';

export interface CallCard {
  pbxCallId: string;
  callId: string | null;
  status: CallCardStatus;
  direction: 'inbound' | 'outbound' | 'internal';
  /** Present for inbound pops; outbound cards start from call:dialing. */
  ringing: RingingPayload | null;
  callee: string | null;
  answeredAt: string | null;
  answeredByMe: boolean;
  hold: boolean;
  muted: boolean;
  transferredTo: string | null;
  endedAt: string | null;
  logged: LoggedPayload | null;
  /** Client receive time (ms) of the first event, for the pop-latency metric. */
  receivedAt: number;
  popLatencyMs: number | null;
}

export interface CancelledEvent {
  pbxCallId: string;
  reason: CancelReason;
  callerDisplay: string | null;
}

interface CallStore {
  /** Newest first. */
  cards: CallCard[];
  /** Last cancellation, for a short toast; cleared by the UI. */
  lastCancelled: CancelledEvent | null;
  onRinging: (payload: RingingPayload, now?: number) => void;
  onDialing: (payload: ServerEventPayload<'call:dialing'>, now?: number) => void;
  onAnswered: (payload: ServerEventPayload<'call:answered'>, myUserId: string) => void;
  onCancelled: (payload: ServerEventPayload<'call:cancelled'>) => void;
  onUpdated: (payload: ServerEventPayload<'call:updated'>) => void;
  onEnded: (payload: ServerEventPayload<'call:ended'>) => void;
  onLogged: (payload: LoggedPayload) => void;
  close: (pbxCallId: string) => void;
  clearCancelled: () => void;
  reset: () => void;
}

function patch(cards: CallCard[], pbxCallId: string, fn: (c: CallCard) => CallCard): CallCard[] {
  return cards.map((c) => (c.pbxCallId === pbxCallId ? fn(c) : c));
}

export const useCallStore = create<CallStore>((set, get) => ({
  cards: [],
  lastCancelled: null,

  onRinging: (payload, now = Date.now()) => {
    if (get().cards.some((c) => c.pbxCallId === payload.pbxCallId)) return; // duplicate delivery
    const card: CallCard = {
      pbxCallId: payload.pbxCallId,
      callId: payload.callId,
      status: 'ringing',
      direction: payload.direction,
      ringing: payload,
      callee: null,
      answeredAt: null,
      answeredByMe: false,
      hold: false,
      muted: false,
      transferredTo: null,
      endedAt: null,
      logged: null,
      receivedAt: now,
      popLatencyMs: Math.max(0, now - Date.parse(payload.at)),
    };
    set((s) => ({ cards: [card, ...s.cards] }));
  },

  onDialing: (payload, now = Date.now()) => {
    if (get().cards.some((c) => c.pbxCallId === payload.pbxCallId)) return;
    const card: CallCard = {
      pbxCallId: payload.pbxCallId,
      callId: payload.callId,
      status: 'dialing',
      direction: 'outbound',
      ringing: null,
      callee: payload.callee,
      answeredAt: null,
      answeredByMe: true,
      hold: false,
      muted: false,
      transferredTo: null,
      endedAt: null,
      logged: null,
      receivedAt: now,
      popLatencyMs: null,
    };
    set((s) => ({ cards: [card, ...s.cards] }));
  },

  onAnswered: (payload, myUserId) => {
    set((s) => ({
      cards: patch(s.cards, payload.pbxCallId, (c) => ({
        ...c,
        callId: c.callId ?? payload.callId,
        status: c.status === 'ringing' || c.status === 'dialing' ? 'answered' : c.status,
        answeredAt: payload.answeredAt,
        answeredByMe: payload.answeredByUserId === myUserId,
      })),
    }));
  },

  onCancelled: (payload) => {
    const card = get().cards.find((c) => c.pbxCallId === payload.pbxCallId);
    set((s) => ({
      cards: s.cards.filter((c) => c.pbxCallId !== payload.pbxCallId),
      lastCancelled: {
        pbxCallId: payload.pbxCallId,
        reason: payload.reason,
        callerDisplay: card?.ringing?.callerDisplay ?? card?.callee ?? null,
      },
    }));
  },

  onUpdated: (payload) => {
    set((s) => ({
      cards: patch(s.cards, payload.pbxCallId, (c) => ({
        ...c,
        hold: payload.hold ?? c.hold,
        muted: payload.muted ?? c.muted,
        transferredTo: payload.transferredTo ?? c.transferredTo,
      })),
    }));
  },

  onEnded: (payload) => {
    set((s) => ({
      cards: patch(s.cards, payload.pbxCallId, (c) => ({
        ...c,
        callId: c.callId ?? payload.callId,
        status: c.status === 'logged' ? c.status : 'ended',
        endedAt: payload.endedAt,
        hold: false,
        muted: false,
      })),
    }));
  },

  onLogged: (payload) => {
    set((s) => {
      const exists = s.cards.some((c) => c.pbxCallId === payload.pbxCallId);
      if (!exists) return s; // logged for a call this user never saw ring (e.g. reconciled CDR)
      return {
        cards: patch(s.cards, payload.pbxCallId, (c) => ({
          ...c,
          callId: payload.callId,
          status: 'logged',
          logged: payload,
        })),
      };
    });
  },

  close: (pbxCallId) => {
    set((s) => ({ cards: s.cards.filter((c) => c.pbxCallId !== pbxCallId) }));
  },
  clearCancelled: () => {
    set({ lastCancelled: null });
  },
  reset: () => {
    set({ cards: [], lastCancelled: null });
  },
}));

/** Seconds since the server-side answer time; the UI ticks this once a second. */
export function talkSeconds(card: CallCard, now: number = Date.now()): number {
  if (!card.answeredAt) return 0;
  const end = card.endedAt ? Date.parse(card.endedAt) : now;
  return Math.max(0, Math.floor((end - Date.parse(card.answeredAt)) / 1000));
}

export const activeCall = (cards: CallCard[]): CallCard | undefined =>
  cards.find((c) => c.status === 'answered' || c.status === 'dialing');
