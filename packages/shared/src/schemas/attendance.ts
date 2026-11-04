import { z } from 'zod';
import { isoDate, isoDateTime, paginationOffset, uuid } from './common.js';

/*
 * No time zone parameter, unlike the other reports. Attendance is a record people are held to, so
 * "which day was this" has one answer, the workspace's, whoever is reading it.
 */
const attendanceRange = z.object({
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  userId: uuid.optional(),
  teamId: uuid.optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

export const attendanceQuery = attendanceRange;

export const PRESENCE_CHANNELS = ['crm', 'phone'] as const;
export const presenceChannel = z.enum(PRESENCE_CHANNELS);
export type PresenceChannel = z.infer<typeof presenceChannel>;

export const PRESENCE_STATES = [
  'online',
  'disconnected',
  'signed_out',
  'phone_offline',
  'phone_idle',
  'phone_ringing',
  'phone_on_call',
] as const;
export const presenceState = z.enum(PRESENCE_STATES);
export type PresenceState = z.infer<typeof presenceState>;

export const presenceChangesQuery = paginationOffset.extend(attendanceRange.shape).extend({
  channel: presenceChannel.optional(),
});

export const logoutReason = z.enum([
  'sign_out',
  'idle',
  'session_ended',
  'disconnected',
  'no_signal',
]);
export type LogoutReason = z.infer<typeof logoutReason>;

export const attendanceDayDto = z.object({
  /** The calendar day in the workspace time zone. */
  date: isoDate,
  /** Where that day begins and ends, so its calls can be asked for without redoing the zone sums. */
  dayStart: isoDateTime,
  dayEnd: isoDateTime,
  userId: uuid,
  name: z.string(),
  extension: z.string().nullable(),
  firstLoginAt: isoDateTime.nullable(),
  /** The agent was already signed in, so this is when they were first seen, not a sign-in. */
  firstLoginInferred: z.boolean(),
  /** Signed in on an earlier day and still signed in when this one began. */
  signedInBeforeDay: z.boolean(),
  lastLogoutAt: isoDateTime.nullable(),
  /** Nobody signed out: this is when the connection was last seen. */
  lastLogoutInferred: z.boolean(),
  lastLogoutReason: logoutReason.nullable(),
  /** Signed in right now. */
  stillSignedIn: z.boolean(),
  /** Stayed signed in past the end of this day. */
  continuedNextDay: z.boolean(),
  firstCallAt: isoDateTime.nullable(),
  calls: z.object({
    total: z.number().int(),
    inbound: z.number().int(),
    outbound: z.number().int(),
    answered: z.number().int(),
    missed: z.number().int(),
    talkSec: z.number().int(),
  }),
});
export type AttendanceDayDto = z.infer<typeof attendanceDayDto>;

export const attendanceReportDto = z.object({
  timeZone: z.string(),
  days: z.array(attendanceDayDto),
  /** When recording began. Days before this have no sign-in data, and that is not absence. */
  recordingSince: isoDateTime.nullable(),
});
export type AttendanceReportDto = z.infer<typeof attendanceReportDto>;

export const presenceChangeDto = z.object({
  id: z.string(),
  userId: uuid,
  name: z.string(),
  channel: presenceChannel,
  /** Null when this is the first state ever recorded for the agent. */
  from: presenceState.nullable(),
  to: presenceState,
  at: isoDateTime,
  /** Null while this state is still the current one. */
  durationSec: z.number().int().nullable(),
  inferred: z.boolean(),
});
export type PresenceChangeDto = z.infer<typeof presenceChangeDto>;

export const attendanceAgentDto = z.object({ id: uuid, name: z.string() });
