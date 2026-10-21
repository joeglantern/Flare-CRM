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
  /** The server's own words for what happened, when it has them. */
  detail: string | null;
  /** Whether the card was this agent's own call going out, which changes how it reads. */
  outbound: boolean;
}

interface CallStore {
  /** Newest first. */
  cards: CallCard[];
  /** Last cancellation, for a short toast; cleared by the UI. */
  lastCancelled: CancelledEvent | null;
  /**
   * Calls already ended here, newest last. Events for one call come from two server processes
   * (the dial answers from the API, a PBX refusal from the worker), so "cancelled" can land a few
   * milliseconds before "dialing". Without this, the late opener put up a Dialing card for a call
   * that was already over, and nothing would ever close it.
   */
  endedIds: string[];
  /** Cards closed here, newest last, so they are never offered again. */
  closedIds: string[];
  onRinging: (payload: RingingPayload, now?: number) => void;
  onDialing: (payload: ServerEventPayload<'call:dialing'>, now?: number) => void;
  onAnswered: (payload: ServerEventPayload<'call:answered'>, myUserId: string) => void;
  onCancelled: (payload: ServerEventPayload<'call:cancelled'>) => void;
  onUpdated: (payload: ServerEventPayload<'call:updated'>) => void;
  onEnded: (payload: ServerEventPayload<'call:ended'>) => void;
  onLogged: (payload: LoggedPayload, now?: number) => void;
  /** An unknown caller was just saved as a contact from the popup itself. */
  onContactLinked: (pbxCallId: string, contact: NonNullable<RingingPayload['contact']>) => void;
  close: (pbxCallId: string) => void;
  clearCancelled: () => void;
  reset: () => void;
}

/**
 * Cards this browser has closed, so a write-up offered again (by the pending check, or a repeated
 * event) does not reopen one the agent already dealt with. Kept per browser; it can be empty.
 */
const CLOSED_KEY = 'crm.closedCallCards';
function readClosed(): string[] {
  try {
    const raw = localStorage.getItem(CLOSED_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function writeClosed(ids: string[]): void {
  try {
    localStorage.setItem(CLOSED_KEY, JSON.stringify(ids));
  } catch {
    // private window or blocked storage: the card may be offered again, which is harmless
  }
}

function patch(cards: CallCard[], pbxCallId: string, fn: (c: CallCard) => CallCard): CallCard[] {
  return cards.map((c) => (c.pbxCallId === pbxCallId ? fn(c) : c));
}

export const useCallStore = create<CallStore>((set, get) => ({
  cards: [],
  lastCancelled: null,
  endedIds: [],
  closedIds: readClosed(),

  onRinging: (payload, now = Date.now()) => {
    if (get().cards.some((c) => c.pbxCallId === payload.pbxCallId)) return; // duplicate delivery
    if (get().endedIds.includes(payload.pbxCallId)) return; // ended before it opened
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

  onContactLinked: (pbxCallId, contact) => {
    set((s) => ({
      cards: patch(s.cards, pbxCallId, (c) =>
        c.ringing === null
          ? c
          : { ...c, ringing: { ...c.ringing, contact, matchCandidates: [], restricted: false } },
      ),
    }));
  },

  onDialing: (payload, now = Date.now()) => {
    if (get().cards.some((c) => c.pbxCallId === payload.pbxCallId)) return;
    if (get().endedIds.includes(payload.pbxCallId)) return; // refused before it opened
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
      endedIds: [...s.endedIds.filter((id) => id !== payload.pbxCallId), payload.pbxCallId].slice(
        -50,
      ),
      cards: s.cards.filter((c) => c.pbxCallId !== payload.pbxCallId),
      lastCancelled: {
        pbxCallId: payload.pbxCallId,
        reason: payload.reason,
        callerDisplay: card?.ringing?.callerDisplay ?? card?.callee ?? null,
        detail: payload.detail ?? null,
        outbound: card?.status === 'dialing' || card?.direction === 'outbound',
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

  onLogged: (payload, now = Date.now()) => {
    set((s) => {
      const exists = s.cards.some((c) => c.pbxCallId === payload.pbxCallId);
      if (!exists) {
        /*
         * The server sends a completed call only to the agent who handled it. The PBX often
         * reports the call only at hangup, so that agent may never have had a ringing card; they
         * still get one now, to write the call up on. Anything else (a missed call, a failed
         * dial) has its own toast and needs no card.
         */
        if (payload.status !== 'completed' || payload.direction === undefined) return s;
        if (s.closedIds.includes(payload.pbxCallId)) return s;
        const card: CallCard = {
          pbxCallId: payload.pbxCallId,
          callId: payload.callId,
          status: 'logged',
          direction: payload.direction,
          ringing: null,
          callee: null,
          answeredAt: null,
          answeredByMe: true,
          hold: false,
          muted: false,
          transferredTo: null,
          endedAt: payload.at,
          logged: payload,
          receivedAt: now,
          popLatencyMs: null,
        };
        return { cards: [card, ...s.cards] };
      }
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
    set((s) => {
      const closedIds = [...s.closedIds.filter((id) => id !== pbxCallId), pbxCallId].slice(-100);
      writeClosed(closedIds);
      return { cards: s.cards.filter((c) => c.pbxCallId !== pbxCallId), closedIds };
    });
  },
  clearCancelled: () => {
    set({ lastCancelled: null });
  },
  reset: () => {
    set({ cards: [], lastCancelled: null, endedIds: [] });
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
