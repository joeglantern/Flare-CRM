/**
 * Turns Yeastar member arrays into a normalized call picture (docs/06 §8–9).
 */
import { normalizePhone, type NormalizedNumber } from '@crm/shared';
import type { CountryCode } from 'libphonenumber-js';
import type { YeastarMemberEntry } from './events.js';

export type Direction = 'inbound' | 'outbound' | 'internal';

export interface ExtensionLeg {
  number: string;
  channelId: string;
  status: string;
}

export interface ClassifiedCall {
  direction: Direction;
  externalRaw: string | null;
  external: NormalizedNumber | null;
  didNumber: string | null;
  trunkName: string | null;
  callPath: string | null;
  extensions: ExtensionLeg[];
  trunkChannelId: string | null;
  trunkStatus: string | null;
  /** For outbound calls, the extension that dialled (from). */
  originatingExtension: string | null;
}

export interface NormalizeOptions {
  defaultCountry: CountryCode;
  internalExtensionLength: number;
}

export function classifyMembers(
  members: YeastarMemberEntry[],
  opts: NormalizeOptions,
): ClassifiedCall {
  const extensions: ExtensionLeg[] = [];
  let direction: Direction = 'internal';
  let externalRaw: string | null = null;
  let didNumber: string | null = null;
  let trunkName: string | null = null;
  let callPath: string | null = null;
  let trunkChannelId: string | null = null;
  let trunkStatus: string | null = null;
  let originatingExtension: string | null = null;

  for (const entry of members) {
    if (entry.extension) {
      extensions.push({
        number: entry.extension.number ?? entry.extension.from ?? '',
        channelId: entry.extension.channel_id,
        status: entry.extension.member_status,
      });
      if (entry.extension.call_path) callPath = entry.extension.call_path;
    }
    if (entry.inbound) {
      direction = 'inbound';
      externalRaw = entry.inbound.from ?? externalRaw;
      didNumber = entry.inbound.to ?? didNumber;
      trunkName = entry.inbound.trunk_name ?? trunkName;
      trunkChannelId = entry.inbound.channel_id;
      trunkStatus = entry.inbound.member_status;
      if (entry.inbound.call_path) callPath = entry.inbound.call_path;
    }
    if (entry.outbound && direction !== 'inbound') {
      direction = 'outbound';
      externalRaw = entry.outbound.to ?? externalRaw;
      originatingExtension = entry.outbound.from ?? originatingExtension;
      trunkName = entry.outbound.trunk_name ?? trunkName;
      trunkChannelId = entry.outbound.channel_id;
      trunkStatus = entry.outbound.member_status;
      if (entry.outbound.call_path) callPath = entry.outbound.call_path;
    }
    if (entry.internal) {
      if (entry.internal.from) originatingExtension = entry.internal.from;
      if (entry.internal.call_path) callPath = entry.internal.call_path;
    }
  }

  const external =
    externalRaw === null
      ? null
      : normalizePhone(externalRaw, {
          defaultCountry: opts.defaultCountry,
          internalExtensionLength: opts.internalExtensionLength,
        });
  return {
    direction,
    externalRaw,
    external,
    didNumber,
    trunkName,
    callPath: callPath === '' ? null : callPath,
    extensions,
    trunkChannelId,
    trunkStatus,
    originatingExtension,
  };
}

/** Best-effort external party from a CDR when no live state was seen (reconciliation). */
export function externalFromCdr(
  cdr: { type: string; call_from: string; call_to: string },
  opts: NormalizeOptions,
): { direction: Direction; externalRaw: string | null; extension: string | null } {
  const type = cdr.type.toLowerCase();
  if (type === 'inbound')
    return {
      direction: 'inbound',
      externalRaw: cdr.call_from,
      extension: isExtension(cdr.call_to, opts) ? cdr.call_to : null,
    };
  if (type === 'outbound')
    return {
      direction: 'outbound',
      externalRaw: cdr.call_to,
      extension: isExtension(cdr.call_from, opts) ? cdr.call_from : null,
    };
  return {
    direction: 'internal',
    externalRaw: null,
    extension: isExtension(cdr.call_from, opts) ? cdr.call_from : null,
  };
}

export function isExtension(value: string, opts: NormalizeOptions): boolean {
  return (
    normalizePhone(value, {
      defaultCountry: opts.defaultCountry,
      internalExtensionLength: opts.internalExtensionLength,
    }).kind === 'extension'
  );
}

export function displayFor(n: NormalizedNumber | null, raw: string | null): string {
  if (!n) return raw ?? 'Unknown';
  switch (n.kind) {
    case 'e164':
      return n.national;
    case 'extension':
      return `Ext ${n.extension}`;
    case 'withheld':
      return 'Withheld number';
    case 'invalid':
      return n.raw;
  }
}

export const IS_RINGING = new Set(['RING', 'ALERT', 'EARLYMEDIA']);
export const IS_TALKING = new Set(['ANSWERED', 'ANSWER']);
