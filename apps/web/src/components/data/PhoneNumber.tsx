/**
 * PhoneNumber (Component Inventory · Data display) — the single source of truth for the
 * "0712 345 678 / +254712345678" rule, used in 30+ places. Optional dial and WhatsApp actions;
 * when doNotCall is set the dial button is blocked and explains why.
 */
import { MessageCircle } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { DialButton, type DialTarget } from '@/features/telephony/dialer';
import { formatPhone, phoneParts } from '@/lib/format';
import { useSettings } from '@/providers/settings';
import { cn } from '@/lib/utils';

export interface PhoneNumberProps {
  e164: string | null | undefined;
  /** Server-provided display value; formatted client-side when absent. */
  display?: string | null;
  layout?: 'stacked' | 'inline' | 'tooltip';
  /** Show the dial and WhatsApp buttons. */
  actions?: boolean;
  doNotCall?: boolean;
  dncSetBy?: string | null;
  type?: string | null;
  primary?: boolean;
  contactId?: string | null;
  phoneId?: string | null;
  contactName?: string;
  contactCompany?: string | null;
  onWhatsApp?: () => void;
  className?: string;
}

export function PhoneNumber({
  e164,
  display,
  layout = 'tooltip',
  actions = false,
  doNotCall = false,
  dncSetBy,
  type,
  primary,
  contactId,
  phoneId,
  contactName,
  contactCompany,
  onWhatsApp,
  className,
}: PhoneNumberProps) {
  const settings = useSettings();
  if (e164 === null || e164 === undefined || e164 === '') {
    return <span className="text-faint">—</span>;
  }
  const parts = phoneParts(e164, settings.defaultCountry as never);
  const national = display ?? parts?.national ?? formatPhone(e164);

  const target: DialTarget = {
    e164,
    display: national,
    contactId: contactId ?? null,
    phoneId: phoneId ?? null,
    doNotCall,
    dncSetBy: dncSetBy ?? null,
    ...(contactName !== undefined ? { contactName } : {}),
    ...(contactCompany !== undefined ? { contactCompany } : {}),
    ...(type != null ? { phoneType: type } : {}),
    ...(primary !== undefined ? { primary } : {}),
  };

  const number =
    layout === 'tooltip' ? (
      <Tooltip content={`${e164} · click to copy`}>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(e164);
          }}
          className="truncate text-left tabular-nums"
        >
          {national}
        </button>
      </Tooltip>
    ) : (
      <span className="truncate font-medium">{national}</span>
    );

  return (
    <span
      className={cn(
        'flex min-w-0 gap-2',
        layout === 'stacked' ? 'flex-col items-start gap-0' : 'items-center',
        className,
      )}
    >
      {number}
      {layout !== 'tooltip' && <span className="mono truncate text-muted">{e164}</span>}
      {type != null && layout === 'inline' && (
        <span className="shrink-0 rounded border border-border px-1.5 text-xs text-muted">
          {type}
          {primary === true && ' · primary'}
        </span>
      )}
      {actions && (
        <span className={cn('flex shrink-0 items-center gap-1', layout === 'stacked' && 'mt-1.5')}>
          <DialButton target={target} />
          {onWhatsApp !== undefined && (
            <Tooltip content="Message on WhatsApp">
              <IconButton
                icon={MessageCircle}
                label="Message on WhatsApp"
                size={26}
                onClick={onWhatsApp}
              />
            </Tooltip>
          )}
        </span>
      )}
    </span>
  );
}
