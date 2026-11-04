/**
 * Attendance and presence reports. Scope comes from the caller's role on the server; `userId` only
 * narrows within it.
 */
import { useQuery } from '@tanstack/react-query';
import type { AttendanceReportDto, CallDto, PresenceChangeDto, PresenceChannel } from '@crm/shared';
import { downloadFile, http, type OffsetList } from '@/lib/api/client';
import { qk } from '@/lib/query';

export interface AttendanceFilters {
  from: string;
  to: string;
  userId?: string;
  [key: string]: string | number | undefined;
}

export function useAttendanceAgents() {
  return useQuery({
    queryKey: qk.list('report-attendance-agents', {}),
    queryFn: () => http.get<{ id: string; name: string }[]>('/api/v1/reports/attendance/agents'),
  });
}

export function useAttendance(filters: AttendanceFilters) {
  return useQuery({
    queryKey: qk.list('report-attendance', filters),
    queryFn: () => http.get<AttendanceReportDto>('/api/v1/reports/attendance', filters),
  });
}

export function usePresenceChanges(
  filters: AttendanceFilters & { channel?: PresenceChannel; page: number; pageSize: number },
) {
  return useQuery({
    queryKey: qk.list('report-presence', filters),
    queryFn: (): Promise<OffsetList<PresenceChangeDto>> =>
      http.list<PresenceChangeDto>('/api/v1/reports/attendance/presence', filters),
  });
}

/** The calls behind one row. A day holds few enough that the first page is all of them. */
export function useAgentDayCalls(day: { userId: string; dayStart: string; dayEnd: string } | null) {
  return useQuery({
    queryKey: qk.list('report-attendance-calls', day ?? {}),
    enabled: day !== null,
    queryFn: () =>
      http.list<CallDto>('/api/v1/calls', {
        userId: day?.userId,
        from: day?.dayStart,
        to: day?.dayEnd,
        pageSize: 100,
      }),
  });
}

export function exportAttendance(filters: AttendanceFilters): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  return downloadFile(
    '/api/v1/reports/attendance',
    { ...filters, format: 'csv' },
    `attendance-${stamp}.csv`,
  );
}

export function exportPresence(
  filters: AttendanceFilters & { channel?: PresenceChannel },
): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  return downloadFile(
    '/api/v1/reports/attendance/presence',
    { ...filters, format: 'csv' },
    `presence-changes-${stamp}.csv`,
  );
}
