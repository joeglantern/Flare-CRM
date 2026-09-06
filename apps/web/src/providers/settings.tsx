/**
 * SettingsProvider / useSettings (Component Inventory · Hooks and providers).
 * `GET /settings/public` for every authenticated user; the full `GET /settings` is loaded on
 * demand by the admin screens. Supplies country, currency, dial rules, popup options, the
 * recording consent text and the idle timeout that useIdleLogout reads.
 */
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { api, unwrap } from '@/lib/api/client';
import { qk } from '@/lib/query';
import { DEFAULT_TZ } from '@/lib/format';
import { useMeOptional } from '@/lib/auth/me';

export interface PublicSettings {
  defaultCountry: string;
  currency: string;
  popup: {
    popOnInternalCalls: boolean;
    autoOpenProfileOnAnswer: boolean;
    suggestFollowUpAfterCall: boolean;
  };
  security: { sessionIdleMinutes: number };
  recording: { consentText: string; allowAgentPlayback: boolean };
}

export interface AppSettings extends PublicSettings {
  /** The signed-in user's IANA zone; every date in the product renders in it. */
  timezone: string;
  timezoneLabel: string;
}

const FALLBACK: AppSettings = {
  defaultCountry: 'KE',
  currency: 'KES',
  popup: {
    popOnInternalCalls: false,
    autoOpenProfileOnAnswer: false,
    suggestFollowUpAfterCall: true,
  },
  security: { sessionIdleMinutes: 60 },
  recording: { consentText: '', allowAgentPlayback: true },
  timezone: DEFAULT_TZ,
  timezoneLabel: 'EAT',
};

export const publicSettingsQuery = queryOptions({
  queryKey: qk.settingsPublic(),
  queryFn: async (): Promise<PublicSettings> =>
    unwrap(await api.GET('/api/v1/settings/public')).data,
  staleTime: 5 * 60_000,
  retry: false,
});

const SettingsContext = createContext<AppSettings>(FALLBACK);

function zoneLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz;
  } catch {
    return tz;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const me = useMeOptional();
  const { data } = useQuery(publicSettingsQuery);
  const value = useMemo<AppSettings>(() => {
    const tz = me?.timezone ?? FALLBACK.timezone;
    return { ...FALLBACK, ...(data ?? {}), timezone: tz, timezoneLabel: zoneLabel(tz) };
  }, [data, me?.timezone]);
  return <SettingsContext value={value}>{children}</SettingsContext>;
}

export function useSettings(): AppSettings {
  return useContext(SettingsContext);
}

/** Full settings; admin screens only (`settings:read`). */
export function useFullSettings() {
  return useQuery({
    queryKey: qk.settings(),
    queryFn: async () => unwrap(await api.GET('/api/v1/settings')).data,
    staleTime: 60_000,
  });
}

export function useInvalidateSettings(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: qk.settings() });
    void qc.invalidateQueries({ queryKey: qk.settingsPublic() });
  };
}
